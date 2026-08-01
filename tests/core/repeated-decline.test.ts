import { describe, expect, it } from "vitest";
import {
  ZeroDOMIntegrationService,
  defineTaskScope
} from "../../src/core/index.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("repeated over-scope decline determinism (Build Spec condition 3)", () => {
  it("declines over-cap attempts identically across 5 independent runs", () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const results: Array<{ result: string; reason: string }> = [];

    for (let i = 1; i <= 5; i++) {
      const account = service.provisionSandboxAccount({
        account_id: `account_overcap_${i}`,
        stripe_connect_id: `acct_overcap_${i}`,
        currency: "usd",
        initial_balance: 10_000,
        api_key: `zd_test_overcap_${i}`
      });
      const scope = defineTaskScope({
        accountId: account.account.account_id,
        taskDescription: `Over-cap decline run ${i}`,
        taskId: `task_overcap_${i}`,
        callerId: `agent_${i}`,
        maxAmount: 5_000,
        currency: "usd",
        merchantLock: { type: "merchant_name", value: "Target Store" },
        ttlSeconds: 300,
        singleUse: true,
        now: NOW
      });
      const issued = service.mintCard(
        { caller_id: scope.caller_id, task_scope: scope },
        { api_key: account.api_key },
        NOW
      );
      const attempt = service.authorizeTransaction(
        {
          card_id: issued.record.card_id,
          attempted_amount: 6_000,
          attempted_merchant: "Target Store"
        },
        { api_key: account.api_key },
        NOW
      );
      results.push({ result: attempt.result, reason: attempt.reason });
    }

    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.result).toBe("declined_amount");
      expect(r.reason).toBe(results[0].reason);
    }
  });

  it("declines wrong-merchant attempts identically across 5 independent runs", () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const results: Array<{ result: string; reason: string }> = [];

    for (let i = 1; i <= 5; i++) {
      const account = service.provisionSandboxAccount({
        account_id: `account_merchant_${i}`,
        stripe_connect_id: `acct_merchant_${i}`,
        currency: "usd",
        initial_balance: 10_000,
        api_key: `zd_test_merchant_${i}`
      });
      const scope = defineTaskScope({
        accountId: account.account.account_id,
        taskDescription: `Wrong-merchant decline run ${i}`,
        taskId: `task_merchant_${i}`,
        callerId: `agent_${i}`,
        maxAmount: 5_000,
        currency: "usd",
        merchantLock: { type: "merchant_name", value: "Target Store" },
        ttlSeconds: 300,
        singleUse: true,
        now: NOW
      });
      const issued = service.mintCard(
        { caller_id: scope.caller_id, task_scope: scope },
        { api_key: account.api_key },
        NOW
      );
      const attempt = service.authorizeTransaction(
        {
          card_id: issued.record.card_id,
          attempted_amount: 4_000,
          attempted_merchant: "Other Store"
        },
        { api_key: account.api_key },
        NOW
      );
      results.push({ result: attempt.result, reason: attempt.reason });
    }

    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.result).toBe("declined_merchant");
      expect(r.reason).toBe(results[0].reason);
    }
  });

  it("declines single-use reuse attempts identically across 5 independent runs", () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const approvedResults: string[] = [];
    const declineResults: Array<{ result: string; reason: string }> = [];

    for (let i = 1; i <= 5; i++) {
      const account = service.provisionSandboxAccount({
        account_id: `account_reuse_${i}`,
        stripe_connect_id: `acct_reuse_${i}`,
        currency: "usd",
        initial_balance: 10_000,
        api_key: `zd_test_reuse_${i}`
      });
      const scope = defineTaskScope({
        accountId: account.account.account_id,
        taskDescription: `Single-use reuse decline run ${i}`,
        taskId: `task_reuse_${i}`,
        callerId: `agent_${i}`,
        maxAmount: 5_000,
        currency: "usd",
        merchantLock: { type: "merchant_name", value: "Target Store" },
        ttlSeconds: 300,
        singleUse: true,
        now: NOW
      });
      const issued = service.mintCard(
        { caller_id: scope.caller_id, task_scope: scope },
        { api_key: account.api_key },
        NOW
      );
      const first = service.authorizeTransaction(
        {
          card_id: issued.record.card_id,
          attempted_amount: 4_000,
          attempted_merchant: "Target Store"
        },
        { api_key: account.api_key },
        NOW
      );
      approvedResults.push(first.result);
      const second = service.authorizeTransaction(
        {
          card_id: issued.record.card_id,
          attempted_amount: 4_000,
          attempted_merchant: "Target Store"
        },
        { api_key: account.api_key },
        NOW
      );
      declineResults.push({ result: second.result, reason: second.reason });
    }

    expect(approvedResults).toHaveLength(5);
    for (const r of approvedResults) {
      expect(r).toBe("approved");
    }
    expect(declineResults).toHaveLength(5);
    for (const r of declineResults) {
      expect(r.result).toBe("declined_reused");
      expect(r.reason).toBe(declineResults[0].reason);
    }
  });

  it("logs every decline with a specific reason in the audit trail across all 5 runs", () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });

    for (let i = 1; i <= 5; i++) {
      const account = service.provisionSandboxAccount({
        account_id: `account_audit_${i}`,
        stripe_connect_id: `acct_audit_${i}`,
        currency: "usd",
        initial_balance: 10_000,
        api_key: `zd_test_audit_${i}`
      });
      const scope = defineTaskScope({
        accountId: account.account.account_id,
        taskDescription: `Audit decline run ${i}`,
        taskId: `task_audit_${i}`,
        callerId: `agent_${i}`,
        maxAmount: 5_000,
        currency: "usd",
        merchantLock: { type: "merchant_name", value: "Target Store" },
        ttlSeconds: 300,
        singleUse: true,
        now: NOW
      });
      const issued = service.mintCard(
        { caller_id: scope.caller_id, task_scope: scope },
        { api_key: account.api_key },
        NOW
      );

      // Over-cap decline
      service.authorizeTransaction(
        {
          card_id: issued.record.card_id,
          attempted_amount: 6_000,
          attempted_merchant: "Target Store"
        },
        { api_key: account.api_key },
        NOW
      );

      const events = service.listAuditLog({}, { api_key: account.api_key });
      const declines = events.filter(
        (e) => e.transaction?.result !== undefined && e.transaction.result !== "approved"
      );
      expect(declines).toHaveLength(1);
      expect(declines[0].transaction!.result).toBe("declined_amount");
      expect(declines[0].transaction!.reason).toBeTruthy();
      expect(declines[0].transaction!.reason).not.toBe("generic failure");
    }
  });
});
