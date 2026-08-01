import { StripeIssuingSandboxClient, defineTaskScope } from "../src/core/index.js";
import * as dotenv from "dotenv";

dotenv.config();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeConnectAccountId = process.env.STRIPE_CONNECT_ACCOUNT_ID;
const cardholderId = process.env.STRIPE_ISSUING_CARDHOLDER_ID;

if (!stripeSecretKey || !cardholderId) {
  console.error("Missing STRIPE_SECRET_KEY=sk_test_... or STRIPE_ISSUING_CARDHOLDER_ID=ich_...");
  process.exit(1);
}

const client = new StripeIssuingSandboxClient({
  stripeSecretKey,
  stripeConnectAccountId: stripeConnectAccountId || undefined,
  cardholderId
});

const now = new Date();
const merchantCategory = process.env.ZERODOM_STRIPE_MERCHANT_CATEGORY ?? "computer_software_stores";
const approvedScope = defineTaskScope({
  taskDescription: "Stripe Issuing sandbox in-scope authorization smoke test",
  taskId: `stripe_smoke_approved_${Date.now()}`,
  callerId: "stripe-smoke-agent",
  maxAmount: 5_000,
  currency: "usd",
  merchantLock: { type: "merchant_category", value: merchantCategory },
  ttlSeconds: 300,
  now
});
const declinedScope = defineTaskScope({
  taskDescription: "Stripe Issuing sandbox over-cap decline smoke test",
  taskId: `stripe_smoke_declined_${Date.now()}`,
  callerId: "stripe-smoke-agent",
  maxAmount: 2_000,
  currency: "usd",
  merchantLock: { type: "merchant_category", value: merchantCategory },
  ttlSeconds: 300,
  now
});

const mintedCardRefs: string[] = [];

try {
  const approvedCard = await client.mintCard(approvedScope);
  mintedCardRefs.push(approvedCard.record.issuer_card_ref);
  const declinedCard = await client.mintCard(declinedScope);
  mintedCardRefs.push(declinedCard.record.issuer_card_ref);
  const approvedAuthorization = await client.simulateAuthorization({
    issuer_card_ref: approvedCard.record.issuer_card_ref,
    attempted_amount: 4_200,
    currency: "usd",
    attempted_merchant: "ZeroDOM Sandbox Merchant",
    attempted_merchant_category: merchantCategory
  });
  const declinedAuthorization = await client.simulateAuthorization({
    issuer_card_ref: declinedCard.record.issuer_card_ref,
    attempted_amount: 2_100,
    currency: "usd",
    attempted_merchant: "ZeroDOM Sandbox Merchant",
    attempted_merchant_category: merchantCategory
  });

  console.log("ZeroDOM Stripe Issuing sandbox smoke");
  console.log("------------------------------------");
  console.log(`approved_card=${approvedCard.record.issuer_card_ref}`);
  console.log(`approved_authorization=${approvedAuthorization.id} approved=${approvedAuthorization.approved}`);
  console.log(`declined_card=${declinedCard.record.issuer_card_ref}`);
  console.log(`declined_authorization=${declinedAuthorization.id} approved=${declinedAuthorization.approved}`);
} finally {
  for (const cardRef of mintedCardRefs) {
    await client.deactivateCard(cardRef).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`cleanup_warning card=${cardRef} message=${message}`);
    });
  }
  if (mintedCardRefs.length > 0) {
    console.log("cleanup=deactivated minted sandbox cards where possible");
  }
}
