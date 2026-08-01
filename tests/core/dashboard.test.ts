import { describe, expect, it } from "vitest";
import {
  SandboxCardIssuerClient,
  buildDashboardSnapshot,
  defineTaskScope,
  formatDashboardSnapshot
} from "../../src/core/index.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("Dashboard/CLI projection", () => {
  it("shows active cards, scope, remaining budget, and audit trail without full card credentials", () => {
    const issuer = new SandboxCardIssuerClient();
    const activeScope = defineTaskScope({
      taskDescription: "Leave a declined card active for review",
      taskId: "task_dashboard_active",
      maxAmount: 2_000,
      currency: "usd",
      merchantLock: { type: "merchant_category", value: "computer_software_stores" },
      ttlSeconds: 300,
      now: NOW
    });
    const usedScope = defineTaskScope({
      taskDescription: "Use one card successfully",
      taskId: "task_dashboard_used",
      maxAmount: 5_000,
      currency: "usd",
      merchantLock: { type: "merchant_category", value: "computer_software_stores" },
      ttlSeconds: 300,
      now: NOW
    });
    const activeCard = issuer.mintCard(activeScope, NOW);
    const usedCard = issuer.mintCard(usedScope, NOW);
    issuer.authorize(
      {
        card_id: activeCard.record.card_id,
        attempted_amount: 2_100,
        attempted_merchant: "Sandbox Laptop Store",
        attempted_merchant_category: "computer_software_stores"
      },
      NOW
    );
    issuer.authorize(
      {
        card_id: usedCard.record.card_id,
        attempted_amount: 4_200,
        attempted_merchant: "Sandbox Laptop Store",
        attempted_merchant_category: "computer_software_stores"
      },
      NOW
    );

    const snapshot = buildDashboardSnapshot({
      issuer,
      auditLog: issuer.auditLog,
      now: NOW,
      expireBeforeRead: false
    });
    const activeSummary = snapshot.active_cards.at(0);
    const rendered = formatDashboardSnapshot(snapshot);
    const activeDetails = issuer.getCardDetails(activeCard.record.card_id);
    const usedDetails = issuer.getCardDetails(usedCard.record.card_id);

    expect(snapshot.active_cards).toHaveLength(1);
    expect(activeSummary).toMatchObject({
      card_id: activeCard.record.card_id,
      task_id: "task_dashboard_active",
      remaining_amount: 2_000,
      authorization_count: 1,
      last_result: "declined_amount",
      scope: {
        merchant_lock: { type: "merchant_category", value: "computer_software_stores" }
      }
    });
    expect(snapshot.audit_events.map((event) => event.type)).toEqual([
      "scope_defined",
      "card_minted",
      "scope_defined",
      "card_minted",
      "transaction_attempt",
      "transaction_attempt",
      "card_revoked"
    ]);
    expect(rendered).toContain("Active cards");
    expect(rendered).toContain("remaining=USD 20.00");
    expect(rendered).toContain("result=declined_amount");
    expect(rendered).toContain("result=approved");
    expect(JSON.stringify(snapshot)).not.toContain(activeDetails.number);
    expect(JSON.stringify(snapshot)).not.toContain(activeDetails.cvc);
    expect(rendered).not.toContain(activeDetails.number);
    expect(rendered).not.toContain(activeDetails.cvc);
    expect(rendered).not.toContain(usedDetails.number);
    expect(rendered).not.toContain(usedDetails.cvc);
  });

  it("auto-expires active cards before rendering when requested", () => {
    const issuer = new SandboxCardIssuerClient();
    const scope = defineTaskScope({
      taskDescription: "Dashboard should clean up stale active cards",
      taskId: "task_dashboard_expiry",
      maxAmount: 2_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Example Shop" },
      ttlSeconds: 1,
      now: NOW
    });
    issuer.mintCard(scope, NOW);

    const snapshot = buildDashboardSnapshot({
      issuer,
      auditLog: issuer.auditLog,
      now: new Date("2026-08-01T00:00:02.000Z")
    });

    expect(snapshot.active_cards).toHaveLength(0);
    expect(snapshot.all_cards.at(0)?.status).toBe("expired");
    expect(snapshot.audit_events.map((event) => event.type)).toContain("card_expired");
  });
});
