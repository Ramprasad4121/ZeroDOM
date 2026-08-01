import type { TaskScope } from "./models.js";
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
