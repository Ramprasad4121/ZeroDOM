import { describe, expect, it, vi } from "vitest";
import {
  StripeIssuingSandboxClient,
  StripeSandboxConfigError,
  defineTaskScope,
  encodeFormParams
} from "../../src/core/index.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("StripeIssuingSandboxClient", () => {
  it("encodes Stripe-style nested form parameters", () => {
    const encoded = encodeFormParams({
      spending_controls: {
        allowed_categories: ["computer_software_stores"],
        spending_limits: [{ amount: 5_000, interval: "per_authorization", categories: ["computer_software_stores"] }]
      }
    });

    expect([...encoded.entries()]).toEqual([
      ["spending_controls[allowed_categories][0]", "computer_software_stores"],
      ["spending_controls[spending_limits][0][amount]", "5000"],
      ["spending_controls[spending_limits][0][interval]", "per_authorization"],
      ["spending_controls[spending_limits][0][categories][0]", "computer_software_stores"]
    ]);
  });

  it("refuses live keys before making any request", () => {
    const fetchImpl = vi.fn();

    expect(
      () =>
        new StripeIssuingSandboxClient({
          stripeSecretKey: ["sk", "live", "forbidden"].join("_"),
          stripeConnectAccountId: "acct_test_connected",
          cardholderId: "ich_test_cardholder",
          fetchImpl
        })
    ).toThrow(StripeSandboxConfigError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates a scoped virtual card under its connected account and uses idempotency", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/issuing/cards")) {
        return jsonResponse({
          id: "ic_test_123",
          created: 1785542400,
          status: "active",
          exp_month: 12,
          exp_year: 2028,
          last4: "4242"
        });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const scope = defineTaskScope({
      taskDescription: "Mint a Stripe sandbox card",
      taskId: "task_stripe_mint",
      maxAmount: 5_000,
      currency: "usd",
      merchantLock: { type: "merchant_category", value: "computer_software_stores" },
      ttlSeconds: 300,
      now: NOW
    });
    const client = new StripeIssuingSandboxClient({
      stripeSecretKey: "sk_test_zerodom",
      stripeConnectAccountId: "acct_test_connected",
      cardholderId: "ich_test_cardholder",
      fetchImpl,
      now: () => NOW
    });

    const issued = await client.mintCard(scope);
    const create = calls[0];
    const createBody = new URLSearchParams(create.init?.body as URLSearchParams);

    expect(issued).toMatchObject({
      record: {
        account_id: "account_local",
        card_id: "card_ic_test_123",
        task_id: "task_stripe_mint",
        issuer_card_ref: "ic_test_123",
        status: "active",
        minted_at: "2026-08-01T00:00:00.000Z"
      },
      card_details: null
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(create.url).toBe("https://api.stripe.com/v1/issuing/cards");
    expect(headerValue(create.init?.headers, "Idempotency-Key")).toBe("zerodom-card-task_stripe_mint");
    expect(headerValue(create.init?.headers, "Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(headerValue(create.init?.headers, "Authorization")).toBe(
      `Basic ${Buffer.from("sk_test_zerodom:").toString("base64")}`
    );
    expect(headerValue(create.init?.headers, "Stripe-Account")).toBe("acct_test_connected");
    expect(createBody.get("cardholder")).toBe("ich_test_cardholder");
    expect(createBody.get("currency")).toBe("usd");
    expect(createBody.get("type")).toBe("virtual");
    expect(createBody.get("status")).toBe("active");
    expect(createBody.get("metadata[zerodom_caller_id]")).toBe("local-agent");
    expect(createBody.get("spending_controls[allowed_categories][0]")).toBe("computer_software_stores");
    expect(createBody.get("spending_controls[spending_limits][0][amount]")).toBe("5000");
    expect(createBody.get("spending_controls[spending_limits][0][interval]")).toBe("per_authorization");
    expect(createBody.get("lifecycle_controls[cancel_after][payment_count]")).toBe("1");
  });

  it("simulates a Stripe Issuing test-helper authorization with merchant data", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({
        id: "iauth_test_123",
        approved: false,
        amount: 6_000,
        currency: "usd",
        status: "closed",
        merchant_data: {
          name: "Sandbox Laptop Store",
          category: "computer_software_stores"
        }
      });
    });
    const client = new StripeIssuingSandboxClient({
      stripeSecretKey: "sk_test_zerodom",
      stripeConnectAccountId: "acct_test_connected",
      cardholderId: "ich_test_cardholder",
      fetchImpl
    });

    const result = await client.simulateAuthorization({
      issuer_card_ref: "ic_test_123",
      attempted_amount: 6_000,
      currency: "usd",
      attempted_merchant: "Sandbox Laptop Store",
      attempted_merchant_category: "computer_software_stores"
    });
    const body = new URLSearchParams(calls[0].init?.body as URLSearchParams);

    expect(calls[0].url).toBe("https://api.stripe.com/v1/test_helpers/issuing/authorizations");
    expect(headerValue(calls[0].init?.headers, "Stripe-Account")).toBe("acct_test_connected");
    expect(body.get("card")).toBe("ic_test_123");
    expect(body.get("amount")).toBe("6000");
    expect(body.get("currency")).toBe("usd");
    expect(body.get("merchant_data[name]")).toBe("Sandbox Laptop Store");
    expect(body.get("merchant_data[category]")).toBe("computer_software_stores");
    expect(result).toEqual({
      id: "iauth_test_123",
      approved: false,
      amount: 6_000,
      currency: "usd",
      status: "closed",
      merchant_name: "Sandbox Laptop Store",
      merchant_category: "computer_software_stores"
    });
  });

  it("deactivates sandbox cards through the card update endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({
        id: "ic_test_123",
        status: "inactive",
        exp_month: 12,
        exp_year: 2028,
        last4: "4242"
      });
    });
    const client = new StripeIssuingSandboxClient({
      stripeSecretKey: "sk_test_zerodom",
      stripeConnectAccountId: "acct_test_connected",
      cardholderId: "ich_test_cardholder",
      fetchImpl
    });

    await client.deactivateCard("ic_test_123");
    const body = new URLSearchParams(calls[0].init?.body as URLSearchParams);

    expect(calls[0].url).toBe("https://api.stripe.com/v1/issuing/cards/ic_test_123");
    expect(calls[0].init?.method).toBe("POST");
    expect(headerValue(calls[0].init?.headers, "Stripe-Account")).toBe("acct_test_connected");
    expect(body.get("status")).toBe("inactive");
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function headerValue(headers: RequestInit["headers"], key: string) {
  return new Headers(headers).get(key);
}
