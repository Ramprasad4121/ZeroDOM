import { describe, expect, it } from "vitest";
import {
  CardIssueError,
  SandboxCardIssuerClient,
  defineTaskScope
} from "../../src/core/index.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("adversarial issuer behavior", () => {
  it("blocks a prompt-injected page that tries to force a second charge", () => {
    const issuer = new SandboxCardIssuerClient();
    const issued = issuer.mintCard(
      defineTaskScope({
        taskDescription: "Buy one item despite hostile checkout copy",
        taskId: "task_prompt_injection",
        maxAmount: 3_000,
        currency: "usd",
        merchantLock: { type: "merchant_name", value: "Example Shop" },
        ttlSeconds: 300,
        now: NOW
      }),
      NOW
    );

    const first = issuer.authorize(
      {
        account_id: issued.record.account_id,
        card_id: issued.record.card_id,
        attempted_amount: 2_500,
        attempted_merchant: "Example Shop"
      },
      NOW
    );
    const second = issuer.authorize(
      {
        account_id: issued.record.account_id,
        card_id: issued.record.card_id,
        attempted_amount: 2_500,
        attempted_merchant: "Example Shop"
      },
      NOW
    );

    expect([first.result, second.result]).toEqual(["approved", "declined_reused"]);
    expect(issuer.getStatusAndHistory(issued.record.card_id, issued.record.account_id).card.status).toBe("used");
    expect(issuer.auditLog.byOutcome(issued.record.account_id, "declined_reused")).toHaveLength(1);
  });

  it("prevents duplicate issuance or scope bypass when the agent retries a failed transaction", () => {
    const issuer = new SandboxCardIssuerClient();
    const scope = defineTaskScope({
      taskDescription: "Retry after failed merchant",
      taskId: "task_retry",
      maxAmount: 3_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Example Shop" },
      ttlSeconds: 300,
      now: NOW
    });
    const issued = issuer.mintCard(scope, NOW);

    const wrongMerchant = issuer.authorize(
      {
        account_id: issued.record.account_id,
        card_id: issued.record.card_id,
        attempted_amount: 2_500,
        attempted_merchant: "Other Shop"
      },
      NOW
    );
    expect(wrongMerchant.result).toBe("declined_merchant");
    expect(() => issuer.mintCard(scope, NOW)).toThrow(CardIssueError);

    const retryInsideScope = issuer.authorize(
      {
        account_id: issued.record.account_id,
        card_id: issued.record.card_id,
        attempted_amount: 2_500,
        attempted_merchant: "Example Shop"
      },
      NOW
    );
    expect(retryInsideScope.result).toBe("approved");
    expect(issuer.listActiveCards(issued.record.account_id)).toHaveLength(0);
  });

  it("expires orphaned active cards after simulated agent process death", () => {
    const issuer = new SandboxCardIssuerClient();
    const issued = issuer.mintCard(
      defineTaskScope({
        taskDescription: "Agent dies before checkout",
        taskId: "task_process_death",
        maxAmount: 3_000,
        currency: "usd",
        merchantLock: { type: "merchant_name", value: "Example Shop" },
        ttlSeconds: 1,
        now: NOW
      }),
      NOW
    );

    const expired = issuer.expireCards(issued.record.account_id, new Date("2026-08-01T00:00:02.000Z"));
    const card = issuer.getStatusAndHistory(issued.record.card_id, issued.record.account_id).card;

    expect(expired.map((record) => record.card_id)).toContain(issued.record.card_id);
    expect(card.status).toBe("expired");
    expect(issuer.listActiveCards(issued.record.account_id)).toHaveLength(0);
    expect(issuer.auditLog.byTask(issued.record.account_id, "task_process_death").map((event) => event.type)).toEqual([
      "scope_defined",
      "card_minted",
      "card_expired"
    ]);
  });

  it("keeps sandbox card numbers and CVC out of the audit trail", () => {
    const issuer = new SandboxCardIssuerClient();
    const issued = issuer.mintCard(
      defineTaskScope({
        taskDescription: "Redaction test",
        taskId: "task_redaction",
        maxAmount: 3_000,
        currency: "usd",
        merchantLock: { type: "merchant_name", value: "Example Shop" },
        ttlSeconds: 300,
        now: NOW
      }),
      NOW
    );
    issuer.authorize(
      {
        account_id: issued.record.account_id,
        card_id: issued.record.card_id,
        attempted_amount: 2_500,
        attempted_merchant: "Example Shop"
      },
      NOW
    );
    const details = issuer.getCardDetails(issued.record.card_id, issued.record.account_id);
    const audit = JSON.stringify(issuer.auditLog.byAccount(issued.record.account_id));

    expect(audit).not.toContain(details.number);
    expect(audit).not.toContain(details.cvc);
  });
});
