import { describe, expect, it } from "vitest";
import {
  CardIssueError,
  ZeroDOMIntegrationService,
  defineTaskScope,
  reconstructTaskStory
} from "../../src/core/index.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("deterministic E2E simulation", () => {
  it("completes a full approved purchase with auto-lock and audit trail", () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const account = service.provisionSandboxAccount({
      account_id: "account_e2e_approved",
      stripe_connect_id: "acct_e2e_approved",
      currency: "usd",
      initial_balance: 10_000,
      api_key: "zd_test_e2e_approved"
    });
    const auth = { api_key: account.api_key };
    const scope = defineTaskScope({
      accountId: account.account.account_id,
      taskDescription: "Full approved purchase",
      taskId: "task_e2e_approved",
      callerId: "e2e-agent",
      maxAmount: 5_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Demo Laptop Store" },
      ttlSeconds: 60,
      singleUse: true,
      now: NOW
    });

    const issued = service.mintCard({ caller_id: scope.caller_id, task_scope: scope }, auth, NOW);
    expect(issued.record.account_id).toBe("account_e2e_approved");
    expect(issued.card_details.last4).toHaveLength(4);

    const attempt = service.authorizeTransaction(
      {
        card_id: issued.record.card_id,
        attempted_amount: 4_200,
        attempted_merchant: "Demo Laptop Store"
      },
      auth,
      NOW
    );
    expect(attempt.result).toBe("approved");

    const status = service.getCardStatus({ card_id: issued.record.card_id }, auth, NOW);
    expect(status.card.status).toBe("used");

    // Balance: 10_000 initial - 4_200 settled = 5_800 (remaining 800 from reservation returned)
    expect(service.accounts.getAccount("account_e2e_approved").available_balance).toBe(5_800);

    const story = reconstructTaskStory(service.auditLog, "account_e2e_approved", "task_e2e_approved");
    expect(story.map((e) => e.type)).toEqual([
      "scope_defined",
      "card_minted",
      "transaction_attempt",
      "card_revoked"
    ]);
    expect(story[2].transaction!.result).toBe("approved");

    // No card credentials in audit trail
    const auditJson = JSON.stringify(story);
    expect(auditJson).not.toContain(issued.card_details.number);
    expect(auditJson).not.toContain(issued.card_details.cvc);
  });

  it("handles a deliberate over-scope attempt as a graceful decline, not a crash", () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const account = service.provisionSandboxAccount({
      account_id: "account_e2e_declined",
      stripe_connect_id: "acct_e2e_declined",
      currency: "usd",
      initial_balance: 10_000,
      api_key: "zd_test_e2e_declined"
    });
    const auth = { api_key: account.api_key };
    const scope = defineTaskScope({
      accountId: account.account.account_id,
      taskDescription: "Deliberate over-scope attempt",
      taskId: "task_e2e_declined",
      callerId: "e2e-agent",
      maxAmount: 3_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Demo Laptop Store" },
      ttlSeconds: 60,
      singleUse: true,
      now: NOW
    });

    const issued = service.mintCard({ caller_id: scope.caller_id, task_scope: scope }, auth, NOW);

    // Amount exceeds cap — should decline gracefully, not throw
    const attempt = service.authorizeTransaction(
      {
        card_id: issued.record.card_id,
        attempted_amount: 5_000,
        attempted_merchant: "Demo Laptop Store"
      },
      auth,
      NOW
    );
    expect(attempt.result).toBe("declined_amount");
    expect(attempt.reason).toBeTruthy();
    expect(attempt.reason).toContain("exceeds cap");

    // Card should still be active after an amount decline
    const status = service.getCardStatus({ card_id: issued.record.card_id }, auth, NOW);
    expect(status.card.status).toBe("active");

    // Balance: 3_000 still reserved (card is active)
    expect(service.accounts.getAccount("account_e2e_declined").available_balance).toBe(7_000);

    const story = reconstructTaskStory(service.auditLog, "account_e2e_declined", "task_e2e_declined");
    expect(story.map((e) => e.type)).toEqual([
      "scope_defined",
      "card_minted",
      "transaction_attempt"
    ]);
    expect(story[2].transaction!.result).toBe("declined_amount");
    expect(story[2].transaction!.reason).toBeTruthy();
  });

  it("maintains strict tenant isolation during concurrent multi-account flows", () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const accountA = service.provisionSandboxAccount({
      account_id: "account_tenant_a",
      stripe_connect_id: "acct_tenant_a",
      currency: "usd",
      initial_balance: 10_000,
      api_key: "zd_test_tenant_a"
    });
    const accountB = service.provisionSandboxAccount({
      account_id: "account_tenant_b",
      stripe_connect_id: "acct_tenant_b",
      currency: "usd",
      initial_balance: 10_000,
      api_key: "zd_test_tenant_b"
    });
    const authA = { api_key: accountA.api_key };
    const authB = { api_key: accountB.api_key };

    const scopeA = defineTaskScope({
      accountId: accountA.account.account_id,
      taskDescription: "Tenant A purchase",
      taskId: "task_tenant_a",
      callerId: "agent-a",
      maxAmount: 5_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Demo Laptop Store" },
      ttlSeconds: 300,
      singleUse: true,
      now: NOW
    });
    const scopeB = defineTaskScope({
      accountId: accountB.account.account_id,
      taskDescription: "Tenant B purchase",
      taskId: "task_tenant_b",
      callerId: "agent-b",
      maxAmount: 5_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Demo Laptop Store" },
      ttlSeconds: 300,
      singleUse: true,
      now: NOW
    });

    const cardA = service.mintCard({ caller_id: scopeA.caller_id, task_scope: scopeA }, authA, NOW);
    const cardB = service.mintCard({ caller_id: scopeB.caller_id, task_scope: scopeB }, authB, NOW);

    // A approves, B declines (over-cap)
    const attemptA = service.authorizeTransaction(
      { card_id: cardA.record.card_id, attempted_amount: 4_000, attempted_merchant: "Demo Laptop Store" },
      authA,
      NOW
    );
    const attemptB = service.authorizeTransaction(
      { card_id: cardB.record.card_id, attempted_amount: 6_000, attempted_merchant: "Demo Laptop Store" },
      authB,
      NOW
    );
    expect(attemptA.result).toBe("approved");
    expect(attemptB.result).toBe("declined_amount");

    // A's audit log has zero B events
    const eventsA = service.listAuditLog({}, authA);
    const eventsB = service.listAuditLog({}, authB);
    expect(eventsA.every((e) => e.account_id === "account_tenant_a")).toBe(true);
    expect(eventsB.every((e) => e.account_id === "account_tenant_b")).toBe(true);

    // A's card is used, B's card is still active
    expect(service.getCardStatus({ card_id: cardA.record.card_id }, authA, NOW).card.status).toBe("used");
    expect(service.getCardStatus({ card_id: cardB.record.card_id }, authB, NOW).card.status).toBe("active");

    // Cross-account card access is rejected
    expect(() => service.getCardStatus({ card_id: cardA.record.card_id }, authB, NOW)).toThrow(CardIssueError);
    expect(() => service.getCardStatus({ card_id: cardB.record.card_id }, authA, NOW)).toThrow(CardIssueError);
  });

  it("reconstructs a complete task story from the audit trail alone", () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const account = service.provisionSandboxAccount({
      account_id: "account_e2e_story",
      stripe_connect_id: "acct_e2e_story",
      currency: "usd",
      initial_balance: 10_000,
      api_key: "zd_test_e2e_story"
    });
    const auth = { api_key: account.api_key };
    const scope = defineTaskScope({
      accountId: account.account.account_id,
      taskDescription: "Full story reconstruction",
      taskId: "task_e2e_story",
      callerId: "story-agent",
      maxAmount: 5_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Demo Laptop Store" },
      ttlSeconds: 60,
      singleUse: true,
      now: NOW
    });

    const issued = service.mintCard({ caller_id: scope.caller_id, task_scope: scope }, auth, NOW);
    service.authorizeTransaction(
      {
        card_id: issued.record.card_id,
        attempted_amount: 4_000,
        attempted_merchant: "Demo Laptop Store"
      },
      auth,
      NOW
    );

    const story = reconstructTaskStory(service.auditLog, "account_e2e_story", "task_e2e_story");
    const types = story.map((e) => e.type);
    expect(types).toEqual(["scope_defined", "card_minted", "transaction_attempt", "card_revoked"]);

    // Timestamps are monotonically non-decreasing
    for (let i = 1; i < story.length; i++) {
      expect(story[i].timestamp >= story[i - 1].timestamp).toBe(true);
    }

    // Every event has the correct identifiers
    for (const event of story) {
      expect(event.account_id).toBe("account_e2e_story");
      expect(event.task_id).toBe("task_e2e_story");
      expect(event.caller_id).toBe("story-agent");
    }
  });
});
