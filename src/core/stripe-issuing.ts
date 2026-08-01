import type { IssuedCard, SandboxCardDetails, TaskScope, TransactionRequest } from "./models.js";
import { validateTaskScope } from "./scope.js";

export class StripeSandboxConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeSandboxConfigError";
  }
}

export interface StripeCardCreateOptions {
  cardholderId: string;
  stripeSecretKey: string;
  now?: Date;
}

export interface StripeSandboxClientOptions {
  stripeSecretKey: string;
  cardholderId: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  now?: () => Date;
}

export interface StripeVirtualCardCreateParams {
  cardholder: string;
  currency: string;
  type: "virtual";
  status: "active";
  metadata: Record<string, string>;
  spending_controls: {
    spending_limits: Array<{
      amount: number;
      interval: "per_authorization";
      categories?: string[];
    }>;
    allowed_categories?: string[];
  };
  lifecycle_controls?: {
    cancel_after: {
      payment_count: number;
    };
  };
}

export interface StripeTestAuthorizationRequest extends Omit<TransactionRequest, "card_id"> {
  issuer_card_ref: string;
  currency: string;
}

export interface StripeTestAuthorizationResult {
  id: string;
  approved: boolean;
  amount: number;
  currency: string;
  status: string;
  merchant_name?: string;
  merchant_category?: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const STRIPE_TEST_SECRET_KEY_PREFIX = "sk_test_";
const STRIPE_LIVE_SECRET_KEY_PREFIX = ["sk", "live"].join("_") + "_";

export function assertStripeSandboxKey(stripeSecretKey: string) {
  if (!stripeSecretKey) {
    throw new StripeSandboxConfigError("STRIPE_SECRET_KEY is required for Stripe Issuing sandbox mode");
  }
  if (stripeSecretKey.startsWith(STRIPE_LIVE_SECRET_KEY_PREFIX)) {
    throw new StripeSandboxConfigError("live Stripe keys are forbidden; use a sandbox sk_test_ key only");
  }
  if (!stripeSecretKey.startsWith(STRIPE_TEST_SECRET_KEY_PREFIX)) {
    throw new StripeSandboxConfigError("Stripe Issuing sandbox mode requires an sk_test_ secret key");
  }
}

export function buildStripeVirtualCardCreateParams(
  scope: TaskScope,
  { cardholderId, stripeSecretKey, now = new Date() }: StripeCardCreateOptions
): StripeVirtualCardCreateParams {
  assertStripeSandboxKey(stripeSecretKey);
  validateTaskScope(scope, now);
  if (!cardholderId) {
    throw new StripeSandboxConfigError("Stripe Issuing cardholder ID is required");
  }
  if (scope.merchant_lock.type !== "merchant_category") {
    throw new StripeSandboxConfigError(
      "issuer-enforced merchant-name locks require Stripe merchant ID controls private preview; use merchant_category for sandbox issuance"
    );
  }

  return {
    cardholder: cardholderId,
    currency: scope.currency,
    type: "virtual",
    status: "active",
    metadata: {
      zerodom_task_id: scope.task_id,
      zerodom_expires_at: scope.expires_at
    },
    spending_controls: {
      allowed_categories: [scope.merchant_lock.value],
      spending_limits: [
        {
          amount: scope.max_amount,
          interval: "per_authorization",
          categories: [scope.merchant_lock.value]
        }
      ]
    },
    lifecycle_controls: scope.single_use
      ? {
          cancel_after: {
            payment_count: 1
          }
        }
      : undefined
  };
}

export class StripeIssuingSandboxClient {
  readonly #stripeSecretKey: string;
  readonly #cardholderId: string;
  readonly #fetchImpl: FetchLike;
  readonly #baseUrl: string;
  readonly #now: () => Date;

  constructor({
    stripeSecretKey,
    cardholderId,
    fetchImpl = fetch,
    baseUrl = "https://api.stripe.com/v1",
    now = () => new Date()
  }: StripeSandboxClientOptions) {
    assertStripeSandboxKey(stripeSecretKey);
    if (!cardholderId) {
      throw new StripeSandboxConfigError("Stripe Issuing cardholder ID is required");
    }
    this.#stripeSecretKey = stripeSecretKey;
    this.#cardholderId = cardholderId;
    this.#fetchImpl = fetchImpl;
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#now = now;
  }

  async mintCard(scope: TaskScope): Promise<IssuedCard> {
    const now = this.#now();
    const params = buildStripeVirtualCardCreateParams(scope, {
      cardholderId: this.#cardholderId,
      stripeSecretKey: this.#stripeSecretKey,
      now
    });
    const card = await this.#request<StripeIssuingCardResponse>("/issuing/cards", {
      method: "POST",
      body: encodeFormParams(params),
      idempotencyKey: `zerodom-card-${scope.task_id}`
    });
    const expanded = await this.retrieveCardDetails(card.id);

    return {
      record: {
        card_id: `card_${card.id}`,
        task_id: scope.task_id,
        issuer_card_ref: card.id,
        status: stripeCardStatusToRecordStatus(card.status),
        minted_at: new Date((card.created ?? Math.floor(now.getTime() / 1000)) * 1000).toISOString()
      },
      scope,
      card_details: expanded
    };
  }

  async retrieveCardDetails(issuerCardRef: string): Promise<SandboxCardDetails> {
    const card = await this.#request<StripeIssuingCardResponse>(`/issuing/cards/${encodeURIComponent(issuerCardRef)}`, {
      method: "GET",
      query: {
        "expand[0]": "number",
        "expand[1]": "cvc"
      }
    });
    if (!card.number || !card.cvc) {
      throw new StripeSandboxConfigError("Stripe did not return expanded sandbox card number and cvc");
    }

    return {
      number: card.number,
      cvc: card.cvc,
      exp_month: card.exp_month,
      exp_year: card.exp_year,
      last4: card.last4
    };
  }

  async simulateAuthorization(request: StripeTestAuthorizationRequest): Promise<StripeTestAuthorizationResult> {
    const authorization = await this.#request<StripeIssuingAuthorizationResponse>("/test_helpers/issuing/authorizations", {
      method: "POST",
      body: encodeFormParams({
        card: request.issuer_card_ref,
        amount: request.attempted_amount,
        currency: request.currency,
        merchant_data: {
          name: request.attempted_merchant,
          category: request.attempted_merchant_category
        }
      })
    });

    return {
      id: authorization.id,
      approved: authorization.approved,
      amount: authorization.amount,
      currency: authorization.currency,
      status: authorization.status,
      merchant_name: authorization.merchant_data?.name,
      merchant_category: authorization.merchant_data?.category
    };
  }

  async deactivateCard(issuerCardRef: string) {
    return this.#request<StripeIssuingCardResponse>(`/issuing/cards/${encodeURIComponent(issuerCardRef)}`, {
      method: "POST",
      body: encodeFormParams({ status: "inactive" })
    });
  }

  async #request<T>(
    path: string,
    {
      method,
      body,
      query,
      idempotencyKey
    }: {
      method: "GET" | "POST";
      body?: URLSearchParams;
      query?: Record<string, string>;
      idempotencyKey?: string;
    }
  ): Promise<T> {
    const url = new URL(`${this.#baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers = new Headers({
      Authorization: `Basic ${Buffer.from(`${this.#stripeSecretKey}:`).toString("base64")}`
    });
    if (body) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
    }
    if (idempotencyKey) {
      headers.set("Idempotency-Key", idempotencyKey);
    }

    const response = await this.#fetchImpl(url.toString(), {
      method,
      headers,
      body
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message ?? `Stripe request failed with HTTP ${response.status}`;
      throw new StripeSandboxConfigError(message);
    }
    return payload as T;
  }
}

export function encodeFormParams(value: unknown, prefix?: string, params = new URLSearchParams()) {
  if (value === undefined) {
    return params;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => encodeFormParams(item, `${prefix}[${index}]`, params));
    return params;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      encodeFormParams(child, prefix ? `${prefix}[${key}]` : key, params);
    }
    return params;
  }
  if (!prefix) {
    throw new StripeSandboxConfigError("cannot encode root scalar form parameter");
  }
  params.append(prefix, String(value));
  return params;
}

interface StripeIssuingCardResponse {
  id: string;
  created?: number;
  status: "active" | "inactive" | "canceled";
  exp_month: number;
  exp_year: number;
  last4: string;
  number?: string;
  cvc?: string;
}

interface StripeIssuingAuthorizationResponse {
  id: string;
  approved: boolean;
  amount: number;
  currency: string;
  status: string;
  merchant_data?: {
    name?: string;
    category?: string;
  };
}

function stripeCardStatusToRecordStatus(status: StripeIssuingCardResponse["status"]) {
  if (status === "active") return "active";
  return "revoked";
}
