import { SandboxCardIssuerClient, buildDashboardSnapshot, defineTaskScope, formatDashboardSnapshot } from "../src/core/index.js";

const now = new Date();
const issuer = new SandboxCardIssuerClient();

const purchaseScope = defineTaskScope({
  taskDescription: "Agent may buy one laptop accessory from the approved merchant category",
  taskId: `task_card_demo_buy_${Date.now()}`,
  callerId: "card-demo-agent",
  maxAmount: 5_000,
  currency: "usd",
  merchantLock: { type: "merchant_category", value: "computer_software_stores" },
  ttlSeconds: 300,
  now
});

const declineScope = defineTaskScope({
  taskDescription: "Agent attempts an over-cap transaction for demo purposes",
  taskId: `task_card_demo_decline_${Date.now()}`,
  callerId: "card-demo-agent",
  maxAmount: 2_000,
  currency: "usd",
  merchantLock: { type: "merchant_category", value: "computer_software_stores" },
  ttlSeconds: 300,
  now
});

const approvedCard = issuer.mintCard(purchaseScope, now);
const declinedCard = issuer.mintCard(declineScope, now);

const approved = issuer.authorize(
  {
    account_id: approvedCard.record.account_id,
    card_id: approvedCard.record.card_id,
    attempted_amount: 4_200,
    attempted_merchant: "Sandbox Laptop Store",
    attempted_merchant_category: "computer_software_stores"
  },
  now
);

const declined = issuer.authorize(
  {
    account_id: declinedCard.record.account_id,
    card_id: declinedCard.record.card_id,
    attempted_amount: 2_100,
    attempted_merchant: "Sandbox Laptop Store",
    attempted_merchant_category: "computer_software_stores"
  },
  now
);

const snapshot = buildDashboardSnapshot({
  accountId: purchaseScope.account_id,
  issuer,
  auditLog: issuer.auditLog,
  now,
  expireBeforeRead: false
});

console.log(`approved_authorization=${approved.result} card=${approvedCard.record.card_id} last4=${approvedCard.card_details.last4}`);
console.log(`declined_authorization=${declined.result} card=${declinedCard.record.card_id} last4=${declinedCard.card_details.last4}`);
console.log("");
console.log(formatDashboardSnapshot(snapshot));
