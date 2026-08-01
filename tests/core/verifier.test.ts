import { describe, expect, it } from "vitest";
import { verifyTransaction } from "../../src/core/verifier.js";
import type { TaskScope } from "../../src/core/models.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");
const EXPIRES_AT = new Date("2026-08-01T01:00:00.000Z").toISOString();

const mockScope: TaskScope = {
  account_id: "account_local",
  task_id: "task_verifier_test",
  caller_id: "agent_verifier",
  max_amount: 5000, // $50.00 in cents
  currency: "usd",
  merchant_lock: { type: "merchant_name", value: "TestBookstore" },
  expires_at: EXPIRES_AT,
  single_use: true
};

describe("Constraint Verifier Tests", () => {
  it("Test A: returns approved for a valid amount and merchant under scope", () => {
    const result = verifyTransaction(mockScope, 4000, "TestBookstore", NOW);
    expect(result).toEqual({ status: "approved" });
  });

  it("Test B (Adversarial): declines transaction if amount exceeds scope by $0.01 (1 cent)", () => {
    const result = verifyTransaction(mockScope, 5001, "TestBookstore", NOW);
    expect(result).toEqual({ status: "declined_amount" });
  });

  it("Test C (Adversarial): declines transaction if merchant does not match scope", () => {
    const result = verifyTransaction(mockScope, 4000, "OtherShop", NOW);
    expect(result).toEqual({ status: "declined_merchant" });
  });

  it("declines transaction if card is expired", () => {
    const lateTime = new Date("2026-08-01T02:00:00.000Z");
    const result = verifyTransaction(mockScope, 4000, "TestBookstore", lateTime);
    expect(result).toEqual({ status: "declined_expired" });
  });

  it("approves fuzzy matches of merchant names", () => {
    // lowercase/whitespace/substring test
    const result1 = verifyTransaction(mockScope, 4000, "  testbookstore  ", NOW);
    const result2 = verifyTransaction(mockScope, 4000, "TestBookstore Online", NOW);
    const result3 = verifyTransaction(mockScope, 4000, "Bookstore", NOW);

    expect(result1.status).toBe("approved");
    expect(result2.status).toBe("approved");
    expect(result3.status).toBe("approved");
  });
});
