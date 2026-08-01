import { describe, expect, it } from "vitest";
import { InMemoryAuditLog, SandboxCardIssuerClient, defineTaskScope, reconstructTaskStory } from "../../src/core/index.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("SandboxCardIssuerClient integration", () => {
  it("mints, approves in-scope use, and blocks reuse after single use", () => {
    const issuer = new SandboxCardIssuerClient();
    const scope = defineTaskScope({
      taskDescription: "Buy a sandbox cart",
      taskId: "task_approve",
      maxAmount: 5_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Example Shop" },
      ttlSeconds: 300,
      now: NOW
    });
    const issued = issuer.mintCard(scope, NOW);

    const approved = issuer.authorize(
      {
        card_id: issued.record.card_id,
        attempted_amount: 4_999,
        attempted_merchant: "example shop"
      },
      NOW
    );
    const reused = issuer.authorize(
      {
        card_id: issued.record.card_id,
        attempted_amount: 1_00,
        attempted_merchant: "example shop"
      },
      NOW
    );

    expect(approved.result).toBe("approved");
    expect(reused.result).toBe("declined_reused");
    expect(issuer.getStatusAndHistory(issued.record.card_id).card.status).toBe("used");
  });

  it("declines attempts above cap with a specific reason and keeps the card active", () => {
    const issuer = new SandboxCardIssuerClient();
    const issued = issuer.mintCard(
      defineTaskScope({
        taskDescription: "Buy inside a small cap",
        taskId: "task_amount_decline",
        maxAmount: 1_000,
        currency: "usd",
        merchantLock: { type: "merchant_name", value: "Example Shop" },
        ttlSeconds: 300,
        now: NOW
      }),
      NOW
    );

    const attempt = issuer.authorize(
      {
        card_id: issued.record.card_id,
        attempted_amount: 1_001,
        attempted_merchant: "Example Shop"
      },
      NOW
    );

    expect(attempt.result).toBe("declined_amount");
    expect(attempt.reason).toContain("exceeds cap");
    expect(issuer.getStatusAndHistory(issued.record.card_id).card.status).toBe("active");
  });

  it("declines wrong merchant and wrong merchant category with specific reasons", () => {
    const issuer = new SandboxCardIssuerClient();
    const nameLocked = issuer.mintCard(
      defineTaskScope({
        taskDescription: "Only this named merchant",
        taskId: "task_wrong_name",
        maxAmount: 1_000,
        currency: "usd",
        merchantLock: { type: "merchant_name", value: "Example Shop" },
        ttlSeconds: 300,
        now: NOW
      }),
      NOW
    );
    const categoryLocked = issuer.mintCard(
      defineTaskScope({
        taskDescription: "Only restaurants",
        taskId: "task_wrong_category",
        maxAmount: 1_000,
        currency: "usd",
        merchantLock: { type: "merchant_category", value: "restaurants" },
        ttlSeconds: 300,
        now: NOW
      }),
      NOW
    );

    expect(
      issuer.authorize(
        {
          card_id: nameLocked.record.card_id,
          attempted_amount: 500,
          attempted_merchant: "Other Shop"
        },
        NOW
      ).result
    ).toBe("declined_merchant");
    expect(
      issuer.authorize(
        {
          card_id: categoryLocked.record.card_id,
          attempted_amount: 500,
          attempted_merchant: "Example Cafe",
          attempted_merchant_category: "book_stores"
        },
        NOW
      ).result
    ).toBe("declined_merchant");
  });

  it("declines expired attempts and expires active orphaned cards", () => {
    const issuer = new SandboxCardIssuerClient();
    const issued = issuer.mintCard(
      defineTaskScope({
        taskDescription: "Short-lived task",
        taskId: "task_expired",
        maxAmount: 1_000,
        currency: "usd",
        merchantLock: { type: "merchant_name", value: "Example Shop" },
        ttlSeconds: 1,
        now: NOW
      }),
      NOW
    );
    const afterExpiry = new Date("2026-08-01T00:00:02.000Z");

    const attempt = issuer.authorize(
      {
        card_id: issued.record.card_id,
        attempted_amount: 500,
        attempted_merchant: "Example Shop"
      },
      afterExpiry
    );

    expect(attempt.result).toBe("declined_expired");
    expect(issuer.getStatusAndHistory(issued.record.card_id).card.status).toBe("expired");
  });

  it("exposes an audit trail queryable by task, card, and outcome", () => {
    const auditLog = new InMemoryAuditLog();
    const issuer = new SandboxCardIssuerClient({ auditLog });
    const scope = defineTaskScope({
      taskDescription: "Audit story",
      taskId: "task_audit",
      maxAmount: 1_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Example Shop" },
      ttlSeconds: 300,
      now: NOW
    });
    const issued = issuer.mintCard(scope, NOW);
    issuer.authorize(
      {
        card_id: issued.record.card_id,
        attempted_amount: 1_001,
        attempted_merchant: "Example Shop"
      },
      NOW
    );

    expect(auditLog.byTask(scope.task_id).map((event) => event.type)).toEqual([
      "scope_defined",
      "card_minted",
      "transaction_attempt"
    ]);
    expect(auditLog.byCard(issued.record.card_id)).toHaveLength(2);
    expect(auditLog.byOutcome("declined_amount")).toHaveLength(1);
    expect(reconstructTaskStory(auditLog, scope.task_id)).toHaveLength(3);
  });
});
