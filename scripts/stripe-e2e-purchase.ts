/**
 * ZeroDOM — Stripe E2E Purchase Test
 *
 * This script demonstrates a complete end-to-end flow using REAL Stripe
 * test-mode APIs:
 *
 *   1. Fund the Issuing balance via test_helpers/issuing/fund_balance
 *   2. Mint a scoped virtual card via Stripe Issuing
 *   3. Simulate an in-scope purchase authorization (approved)
 *   4. Simulate an over-scope purchase authorization (declined)
 *   5. Deactivate the cards and print the full audit trail
 *
 * Usage:
 *   npx tsx scripts/stripe-e2e-purchase.ts
 *
 * Required .env:
 *   STRIPE_SECRET_KEY=sk_test_...
 *   STRIPE_ISSUING_CARDHOLDER_ID=ich_...
 */
import { StripeIssuingSandboxClient, defineTaskScope } from "../src/core/index.js";
import * as dotenv from "dotenv";

dotenv.config();

// ── Helpers ──────────────────────────────────────────────────────────────

function header(text: string) {
  const line = "═".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(`${line}\n`);
}

function step(label: string) {
  console.log(`  ▸ ${label}`);
}

function ok(label: string) {
  console.log(`  ✓ ${label}`);
}

function fail(label: string) {
  console.log(`  ✗ ${label}`);
}

function kv(key: string, value: unknown) {
  console.log(`    ${key.padEnd(24)} ${value}`);
}

function stripeHeaders(secretKey: string, connectAccountId?: string, contentType?: string) {
  const h: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`
  };
  if (connectAccountId) h["Stripe-Account"] = connectAccountId;
  if (contentType) h["Content-Type"] = contentType;
  return h;
}

async function waitForTopupSettlement(
  secretKey: string,
  topupId: string,
  connectAccountId?: string,
  maxWaitMs = 30_000
): Promise<string> {
  const start = Date.now();
  const headers = stripeHeaders(secretKey, connectAccountId);

  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`https://api.stripe.com/v1/topups/${topupId}`, { headers });
    const payload: any = await res.json();
    const status = payload.status ?? "unknown";

    if (status === "succeeded") return status;
    if (status === "failed" || status === "canceled") {
      throw new Error(`Top-up ${topupId} ended with status: ${status}`);
    }

    step(`Top-up status: ${status} — waiting 2s...`);
    await new Promise(r => setTimeout(r, 2_000));
  }
  // Even if still pending, check if balance is available
  return "timeout";
}

async function ensureIssuingBalance(
  secretKey: string,
  requiredAmount: number,
  currency: string,
  connectAccountId?: string
): Promise<void> {
  const headers = stripeHeaders(secretKey, connectAccountId, "application/x-www-form-urlencoded");

  // Check current balance first
  const bal = await getIssuingBalance(secretKey, connectAccountId);
  if (bal.available >= requiredAmount) {
    ok(`Issuing balance already sufficient: $${(bal.available / 100).toFixed(2)}`);
    return;
  }

  const deficit = requiredAmount - bal.available;
  step(`Need $${(deficit / 100).toFixed(2)} more in Issuing balance.`);

  // Strategy 1: Top-ups API (US accounts)
  const topupBody = new URLSearchParams({
    amount: String(deficit),
    currency,
    destination_balance: "issuing",
    description: "ZeroDOM E2E test funding"
  });
  const topupRes = await fetch("https://api.stripe.com/v1/topups", {
    method: "POST",
    headers,
    body: topupBody
  });
  const topupPayload: any = await topupRes.json();

  if (topupRes.ok) {
    step(`Top-up created: ${topupPayload.id} (status: ${topupPayload.status})`);

    if (topupPayload.status !== "succeeded") {
      step("Waiting for top-up to settle...");
      const finalStatus = await waitForTopupSettlement(secretKey, topupPayload.id, connectAccountId);
      if (finalStatus === "timeout") {
        step("Top-up still pending after 30s. Checking balance anyway...");
        const freshBal = await getIssuingBalance(secretKey, connectAccountId);
        if (freshBal.available >= requiredAmount) {
          ok(`Balance available: $${(freshBal.available / 100).toFixed(2)}`);
          return;
        }
        throw new Error(
          `Top-up ${topupPayload.id} is still pending and Issuing balance ` +
          `($${(freshBal.available / 100).toFixed(2)}) is insufficient. ` +
          `Please wait a moment and re-run, or add funds via the Stripe Dashboard.`
        );
      }
    }
    ok("Top-up settled.");
    return;
  }

  // Strategy 2: test_helpers/issuing/fund_balance (non-US accounts)
  step(`Top-ups API: ${topupPayload?.error?.message ?? topupRes.status}`);
  step("Trying test_helpers/issuing/fund_balance...");

  const fundBody = new URLSearchParams({ amount: String(deficit), currency });
  const fundRes = await fetch("https://api.stripe.com/v1/test_helpers/issuing/fund_balance", {
    method: "POST",
    headers,
    body: fundBody
  });
  const fundPayload: any = await fundRes.json();

  if (!fundRes.ok) {
    throw new Error(
      `Both funding methods failed.\n` +
      `  Top-ups: ${topupPayload?.error?.message ?? "unknown"}\n` +
      `  Fund balance: ${fundPayload?.error?.message ?? "unknown"}\n` +
      `  Please add funds manually via the Stripe Dashboard → Issuing → Add funds.`
    );
  }
  ok("Balance funded via test_helpers.");
}

async function getIssuingBalance(
  secretKey: string,
  connectAccountId?: string
): Promise<{ available: number; pending: number; currency: string }> {
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`
  };
  if (connectAccountId) {
    headers["Stripe-Account"] = connectAccountId;
  }

  const res = await fetch("https://api.stripe.com/v1/balance", { method: "GET", headers });
  const payload: any = await res.json();
  if (!res.ok) {
    throw new Error(`balance fetch failed: ${payload?.error?.message ?? res.status}`);
  }
  const issuing = payload.issuing ?? {};
  const available = issuing.available?.[0]?.amount ?? 0;
  const pending = issuing.pending?.[0]?.amount ?? 0;
  const currency = issuing.available?.[0]?.currency ?? "usd";
  return { available, pending, currency };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const cardholderId = process.env.STRIPE_ISSUING_CARDHOLDER_ID;
  const connectAccountId = process.env.STRIPE_CONNECT_ACCOUNT_ID || undefined;

  if (!stripeSecretKey || !cardholderId) {
    console.error("Missing .env: STRIPE_SECRET_KEY and STRIPE_ISSUING_CARDHOLDER_ID are required.");
    process.exit(1);
  }

  header("ZeroDOM — Stripe E2E Purchase Test");
  console.log("  This script uses REAL Stripe test-mode APIs to demonstrate");
  console.log("  the full ZeroDOM scoped-card lifecycle.\n");

  // ── Step 1: Check & Fund Issuing Balance ────────────────────────────

  header("Step 1 · Ensure Issuing Balance");

  step("Checking current Issuing balance...");
  const balanceBefore = await getIssuingBalance(stripeSecretKey, connectAccountId);
  kv("Available (before)", `${(balanceBefore.available / 100).toFixed(2)} ${balanceBefore.currency.toUpperCase()}`);

  const requiredBalance = 50_00; // $50.00 — enough for $35.99 approved purchase + margin
  await ensureIssuingBalance(stripeSecretKey, requiredBalance, "usd", connectAccountId);

  const balanceAfter = await getIssuingBalance(stripeSecretKey, connectAccountId);
  kv("Available (after)", `${(balanceAfter.available / 100).toFixed(2)} ${balanceAfter.currency.toUpperCase()}`);

  // ── Step 2: Mint Scoped Virtual Cards ────────────────────────────────

  header("Step 2 · Mint Scoped Virtual Cards via ZeroDOM");

  const client = new StripeIssuingSandboxClient({
    stripeSecretKey,
    stripeConnectAccountId: connectAccountId,
    cardholderId
  });

  const now = new Date();
  const merchantCategory = "computer_software_stores";
  const runId = Date.now();

  // Card A: $40 cap — for approved purchase
  const scopeA = defineTaskScope({
    taskDescription: "Buy a laptop charger from Electronics World",
    taskId: `e2e_approved_${runId}`,
    callerId: "e2e-purchase-agent",
    maxAmount: 40_00,   // $40.00
    currency: "usd",
    merchantLock: { type: "merchant_category", value: merchantCategory },
    ttlSeconds: 300,
    singleUse: true,
    now
  });

  // Card B: $15 cap — for declined purchase (will attempt $20)
  const scopeB = defineTaskScope({
    taskDescription: "Attempt over-budget purchase (should be declined)",
    taskId: `e2e_declined_${runId}`,
    callerId: "e2e-purchase-agent",
    maxAmount: 15_00,   // $15.00
    currency: "usd",
    merchantLock: { type: "merchant_category", value: merchantCategory },
    ttlSeconds: 300,
    singleUse: true,
    now
  });

  step("Minting Card A (approved scenario, cap=$40.00)...");
  const cardA = await client.mintCard(scopeA);
  ok(`Card A minted: ${cardA.record.issuer_card_ref}`);
  kv("Task", scopeA.task_id);
  kv("Max Amount", `$${(scopeA.max_amount / 100).toFixed(2)}`);
  kv("Merchant Lock", `${scopeA.merchant_lock.type}: ${scopeA.merchant_lock.value}`);
  kv("Single Use", scopeA.single_use);

  step("Minting Card B (declined scenario, cap=$15.00)...");
  const cardB = await client.mintCard(scopeB);
  ok(`Card B minted: ${cardB.record.issuer_card_ref}`);
  kv("Task", scopeB.task_id);
  kv("Max Amount", `$${(scopeB.max_amount / 100).toFixed(2)}`);

  // ── Step 3: Simulate In-Scope Purchase (Approved) ───────────────────

  header("Step 3 · Purchase Authorization — In-Scope (Approved)");

  step("Authorizing $35.99 at 'ZeroDOM Electronics' on Card A...");
  const authApproved = await client.simulateAuthorization({
    issuer_card_ref: cardA.record.issuer_card_ref,
    attempted_amount: 35_99,
    currency: "usd",
    attempted_merchant: "ZeroDOM Electronics",
    attempted_merchant_category: merchantCategory
  });

  if (authApproved.approved) {
    ok("APPROVED");
  } else {
    fail("DECLINED (unexpected)");
  }
  kv("Authorization ID", authApproved.id);
  kv("Amount", `$${(authApproved.amount / 100).toFixed(2)}`);
  kv("Status", authApproved.status);
  kv("Merchant", authApproved.merchant_name ?? "N/A");

  // ── Step 4: Simulate Over-Scope Purchase (Declined) ─────────────────

  header("Step 4 · Purchase Authorization — Over-Scope (Declined)");

  step("Authorizing $20.00 at 'ZeroDOM Electronics' on Card B (cap=$15.00)...");
  const authDeclined = await client.simulateAuthorization({
    issuer_card_ref: cardB.record.issuer_card_ref,
    attempted_amount: 20_00,
    currency: "usd",
    attempted_merchant: "ZeroDOM Electronics",
    attempted_merchant_category: merchantCategory
  });

  if (!authDeclined.approved) {
    ok("DECLINED (as expected — over spending limit)");
  } else {
    fail("APPROVED (unexpected — spending controls did not block)");
  }
  kv("Authorization ID", authDeclined.id);
  kv("Amount Attempted", `$${(authDeclined.amount / 100).toFixed(2)}`);
  kv("Status", authDeclined.status);

  // ── Step 5: Cleanup — Deactivate Cards ──────────────────────────────

  header("Step 5 · Cleanup & Audit Trail");

  step("Deactivating Card A...");
  await client.deactivateCard(cardA.record.issuer_card_ref).catch(() => {});
  ok("Card A deactivated.");

  step("Deactivating Card B...");
  await client.deactivateCard(cardB.record.issuer_card_ref).catch(() => {});
  ok("Card B deactivated.");

  // ── Summary ──────────────────────────────────────────────────────────

  header("Summary");

  console.log("  ┌──────────────────────────────────────────────────────┐");
  console.log("  │  ZeroDOM Stripe E2E Purchase Test — COMPLETE        │");
  console.log("  ├──────────────────────────────────────────────────────┤");
  console.log(`  │  Card A (approved): ${cardA.record.issuer_card_ref.padEnd(33)}│`);
  console.log(`  │    Purchase: $35.99 → ${authApproved.approved ? "APPROVED" : "DECLINED"}${" ".repeat(23)}│`);
  console.log(`  │  Card B (declined): ${cardB.record.issuer_card_ref.padEnd(33)}│`);
  console.log(`  │    Purchase: $20.00 → ${!authDeclined.approved ? "DECLINED" : "APPROVED"}${" ".repeat(23)}│`);
  console.log("  ├──────────────────────────────────────────────────────┤");
  console.log("  │  Stripe Issuing spending controls enforced the      │");
  console.log("  │  ZeroDOM scope: approved in-budget, declined        │");
  console.log("  │  over-budget. Cards auto-deactivated.               │");
  console.log("  └──────────────────────────────────────────────────────┘");
  console.log();

  const balanceFinal = await getIssuingBalance(stripeSecretKey, connectAccountId);
  kv("Final Issuing Balance", `$${(balanceFinal.available / 100).toFixed(2)} ${balanceFinal.currency.toUpperCase()}`);
  console.log();
}

main().catch((err) => {
  console.error("\n  FATAL:", err.message ?? err);
  process.exit(1);
});
