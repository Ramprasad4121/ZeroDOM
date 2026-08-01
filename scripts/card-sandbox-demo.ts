import { SandboxCardIssuerClient, defineTaskScope, reconstructTaskStory } from "../src/core/index.js";

const now = new Date();
const issuer = new SandboxCardIssuerClient();

const purchaseScope = defineTaskScope({
  taskDescription: "Agent may buy one laptop accessory from the approved merchant category",
  taskId: `task_card_demo_buy_${Date.now()}`,
  maxAmount: 5_000,
  currency: "usd",
  merchantLock: { type: "merchant_category", value: "computer_software_stores" },
  ttlSeconds: 300,
  now
});

const declineScope = defineTaskScope({
  taskDescription: "Agent attempts an over-cap transaction for demo purposes",
  taskId: `task_card_demo_decline_${Date.now()}`,
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
    card_id: approvedCard.record.card_id,
    attempted_amount: 4_200,
    attempted_merchant: "Sandbox Laptop Store",
    attempted_merchant_category: "computer_software_stores"
  },
  now
);

const declined = issuer.authorize(
  {
    card_id: declinedCard.record.card_id,
    attempted_amount: 2_100,
    attempted_merchant: "Sandbox Laptop Store",
    attempted_merchant_category: "computer_software_stores"
  },
  now
);

console.log("ZeroDOM scoped virtual-card sandbox");
console.log("-----------------------------------");
console.log(`approved card: ${approvedCard.record.card_id} last4=${approvedCard.card_details.last4} result=${approved.result}`);
console.log(`declined card: ${declinedCard.record.card_id} last4=${declinedCard.card_details.last4} result=${declined.result}`);
console.log("");
console.log("audit story for approved task:");
for (const event of reconstructTaskStory(issuer.auditLog, purchaseScope.task_id)) {
  const outcome = event.transaction ? ` outcome=${event.transaction.result}` : "";
  console.log(`- ${event.timestamp} ${event.type}${outcome}`);
}
console.log("");
console.log("audit story for declined task:");
for (const event of reconstructTaskStory(issuer.auditLog, declineScope.task_id)) {
  const outcome = event.transaction ? ` outcome=${event.transaction.result}` : "";
  console.log(`- ${event.timestamp} ${event.type}${outcome}`);
}
