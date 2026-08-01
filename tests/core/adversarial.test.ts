import { describe, expect, it } from "vitest";
import {
  CardIssueError,
  SandboxCardIssuerClient,
  ScriptedAgentExecutor,
  defineTaskScope
} from "../../src/core/index.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("adversarial issuer behavior", () => {
  it("blocks a prompt-injected page that tries to force a second charge", () => {
    const issuer = new SandboxCardIssuerClient();
    const executor = new ScriptedAgentExecutor(issuer);
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

    const result = executor.runCheckout({
      cardId: issued.record.card_id,
      now: NOW,
      steps: [
        {
          label: "intended checkout",
          attempted_amount: 2_500,
          attempted_merchant: "Example Shop"
        },
        {
          label: "prompt-injected second checkout",
          attempted_amount: 2_500,
          attempted_merchant: "Example Shop"
        }
      ]
    });

    expect(result.attempts.map((attempt) => attempt.result)).toEqual(["approved", "declined_reused"]);
    expect(result.card.status).toBe("used");
    expect(issuer.auditLog.byOutcome("declined_reused")).toHaveLength(1);
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
        card_id: issued.record.card_id,
        attempted_amount: 2_500,
        attempted_merchant: "Example Shop"
      },
      NOW
    );
    expect(retryInsideScope.result).toBe("approved");
    expect(issuer.listActiveCards()).toHaveLength(0);
  });

  it("expires orphaned active cards after simulated agent process death", () => {
    const issuer = new SandboxCardIssuerClient();
    const executor = new ScriptedAgentExecutor(issuer);
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

    const expired = executor.simulateProcessDeath({
      afterMintedCardId: issued.record.card_id,
      at: new Date("2026-08-01T00:00:02.000Z")
    });

    expect(expired.status).toBe("expired");
    expect(issuer.listActiveCards()).toHaveLength(0);
    expect(issuer.auditLog.byTask("task_process_death").map((event) => event.type)).toEqual([
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
        card_id: issued.record.card_id,
        attempted_amount: 2_500,
        attempted_merchant: "Example Shop"
      },
      NOW
    );
    const details = issuer.getCardDetails(issued.record.card_id);
    const audit = JSON.stringify(issuer.auditLog.all());

    expect(audit).not.toContain(details.number);
    expect(audit).not.toContain(details.cvc);
  });
});
