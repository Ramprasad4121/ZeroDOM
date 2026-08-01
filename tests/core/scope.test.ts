import { describe, expect, it } from "vitest";
import {
  ScopeValidationError,
  StripeSandboxConfigError,
  buildStripeVirtualCardCreateParams,
  defineTaskScope,
  validateTaskScope
} from "../../src/core/index.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("TaskScope validation", () => {
  it("defines a complete single-use merchant-category scope", () => {
    const scope = defineTaskScope({
      taskDescription: "Buy a replacement laptop charger",
      taskId: "task_scope_valid",
      maxAmount: 4_500,
      currency: "usd",
      merchantLock: { type: "merchant_category", value: "computer_software_stores" },
      ttlSeconds: 300,
      now: NOW
    });

    expect(scope).toMatchObject({
      task_id: "task_scope_valid",
      max_amount: 4_500,
      currency: "usd",
      merchant_lock: { type: "merchant_category", value: "computer_software_stores" },
      single_use: true
    });
    expect(scope.expires_at).toBe("2026-08-01T00:05:00.000Z");
  });

  it("rejects missing or malformed amount caps", () => {
    expect(() =>
      validateTaskScope(
        {
          task_id: "task_missing_cap",
          currency: "usd",
          merchant_lock: { type: "merchant_name", value: "Example Shop" },
          expires_at: "2026-08-01T00:05:00.000Z",
          single_use: true
        },
        NOW
      )
    ).toThrow(ScopeValidationError);
    expect(() =>
      validateTaskScope(
        {
          account_id: "account_scope_test",
          task_id: "task_zero_cap",
          max_amount: 0,
          currency: "usd",
          merchant_lock: { type: "merchant_name", value: "Example Shop" },
          expires_at: "2026-08-01T00:05:00.000Z",
          single_use: true
        },
        NOW
      )
    ).toThrow("max_amount");
  });

  it("rejects missing expiry and merchant lock", () => {
    expect(() =>
      validateTaskScope(
        {
          account_id: "account_scope_test",
          task_id: "task_missing_expiry",
          max_amount: 1_000,
          currency: "usd",
          merchant_lock: { type: "merchant_name", value: "Example Shop" },
          single_use: true
        },
        NOW
      )
    ).toThrow("expires_at");
    expect(() =>
      validateTaskScope(
        {
          account_id: "account_scope_test",
          task_id: "task_missing_merchant",
          max_amount: 1_000,
          currency: "usd",
          expires_at: "2026-08-01T00:05:00.000Z",
          single_use: true
        },
        NOW
      )
    ).toThrow("merchant_lock");
  });
});

describe("Stripe Issuing sandbox parameter guard", () => {
  it("maps issuer-enforceable scope fields to Stripe virtual-card controls", () => {
    const scope = defineTaskScope({
      taskDescription: "Book a test-mode hotel stay",
      taskId: "task_stripe_params",
      maxAmount: 12_500,
      currency: "usd",
      merchantLock: { type: "merchant_category", value: "lodging_hotels_motels_resorts" },
      ttlSeconds: 600,
      now: NOW
    });

    const params = buildStripeVirtualCardCreateParams(scope, {
      cardholderId: "ich_test_cardholder",
      stripeSecretKey: "sk_test_zerodom",
      now: NOW
    });

    expect(params).toMatchObject({
      cardholder: "ich_test_cardholder",
      currency: "usd",
      type: "virtual",
      status: "active",
      spending_controls: {
        allowed_categories: ["lodging_hotels_motels_resorts"],
        spending_limits: [
          {
            amount: 12_500,
            interval: "per_authorization",
            categories: ["lodging_hotels_motels_resorts"]
          }
        ]
      },
      lifecycle_controls: {
        cancel_after: {
          payment_count: 1
        }
      }
    });
  });

  it("fails closed for live keys and merchant-name locks that are not public issuer controls", () => {
    const scope = defineTaskScope({
      taskDescription: "Buy from a named merchant",
      taskId: "task_stripe_name_lock",
      maxAmount: 2_500,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Example Shop" },
      ttlSeconds: 600,
      now: NOW
    });

    expect(() =>
      buildStripeVirtualCardCreateParams(scope, {
        cardholderId: "ich_test_cardholder",
        stripeSecretKey: ["sk", "live", "forbidden"].join("_"),
        now: NOW
      })
    ).toThrow(StripeSandboxConfigError);
    expect(() =>
      buildStripeVirtualCardCreateParams(scope, {
        cardholderId: "ich_test_cardholder",
        stripeSecretKey: "sk_test_zerodom",
        now: NOW
      })
    ).toThrow("merchant-name locks");
  });
});
