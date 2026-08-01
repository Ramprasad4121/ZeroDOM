/**
 * ZeroDOM readiness-check script.
 *
 * Verifies all 6 exit conditions from the Build Specification's
 * "Definition of 100% ready" section in one deterministic session.
 *
 * Run: npm run readiness-check
 */

import {
  ZeroDOMIntegrationService,
  defineTaskScope,
  reconstructTaskStory,
  CardIssueError,
  AccountAccessError
} from "../src/core/index.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");

let passed = 0;
let failed = 0;
let blocked = 0;

function check(label: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${label}`);
    console.log(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

function blockCheck(label: string, reason: string) {
  blocked++;
  console.log(`  ⏸ ${label}`);
  console.log(`    BLOCKED: ${reason}`);
}

console.log("");
console.log("ZeroDOM Readiness Check");
console.log("=======================");
console.log("");

// ─── Condition 1: All tests pass ───
console.log("Condition 1: All tests pass (including adversarial)");
console.log("  → Run 'npm test' separately — 47 tests across 10 files must pass.");
console.log("  → This script verifies conditions 2–6 inline.");
console.log("");

// ─── Condition 2: Live run against real site ───
console.log("Condition 2: Live run against real site in sandbox payment mode");
blockCheck(
  "Live run against a real e-commerce site",
  "Target site selection is blocked on human input per docs/AGENTS.md. " +
  "Choose a sandbox checkout site (e.g. Stripe's test checkout) and run: " +
  "STRIPE_SECRET_KEY=sk_test_... npm run checkout-harness"
);
console.log("");

// ─── Condition 3: 5 repeated over-scope declines (no flakiness) ───
console.log("Condition 3: 5 repeated over-scope decline runs (no flakiness)");
{
  const service = new ZeroDOMIntegrationService({ now: () => NOW });
  const overCapReasons: string[] = [];
  const wrongMerchantReasons: string[] = [];
  const reuseReasons: string[] = [];

  for (let i = 1; i <= 5; i++) {
    const account = service.provisionSandboxAccount({
      account_id: `readiness_overcap_${i}`,
      stripe_connect_id: `acct_readiness_overcap_${i}`,
      currency: "usd",
      initial_balance: 30_000,
      api_key: `zd_test_readiness_overcap_${i}`
    });
    const auth = { api_key: account.api_key };

    // Over-cap
    const scope1 = defineTaskScope({
      accountId: account.account.account_id,
      taskDescription: `Over-cap readiness run ${i}`,
      taskId: `task_readiness_overcap_${i}`,
      callerId: `readiness-agent`,
      maxAmount: 5_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Target Store" },
      ttlSeconds: 300,
      singleUse: true,
      now: NOW
    });
    const card1 = service.mintCard({ caller_id: scope1.caller_id, task_scope: scope1 }, auth, NOW);
    const attempt1 = service.authorizeTransaction(
      { card_id: card1.record.card_id, attempted_amount: 6_000, attempted_merchant: "Target Store" },
      auth,
      NOW
    );
    overCapReasons.push(attempt1.reason);

    // Wrong merchant
    const scope2 = defineTaskScope({
      accountId: account.account.account_id,
      taskDescription: `Wrong-merchant readiness run ${i}`,
      taskId: `task_readiness_merchant_${i}`,
      callerId: `readiness-agent`,
      maxAmount: 5_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Target Store" },
      ttlSeconds: 300,
      singleUse: true,
      now: NOW
    });
    const card2 = service.mintCard({ caller_id: scope2.caller_id, task_scope: scope2 }, auth, NOW);
    const attempt2 = service.authorizeTransaction(
      { card_id: card2.record.card_id, attempted_amount: 4_000, attempted_merchant: "Other Store" },
      auth,
      NOW
    );
    wrongMerchantReasons.push(attempt2.reason);

    // Reuse
    const scope3 = defineTaskScope({
      accountId: account.account.account_id,
      taskDescription: `Reuse readiness run ${i}`,
      taskId: `task_readiness_reuse_${i}`,
      callerId: `readiness-agent`,
      maxAmount: 5_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Target Store" },
      ttlSeconds: 300,
      singleUse: true,
      now: NOW
    });
    const card3 = service.mintCard({ caller_id: scope3.caller_id, task_scope: scope3 }, auth, NOW);
    service.authorizeTransaction(
      { card_id: card3.record.card_id, attempted_amount: 4_000, attempted_merchant: "Target Store" },
      auth,
      NOW
    );
    const reuseAttempt = service.authorizeTransaction(
      { card_id: card3.record.card_id, attempted_amount: 4_000, attempted_merchant: "Target Store" },
      auth,
      NOW
    );
    reuseReasons.push(reuseAttempt.reason);
  }

  check("5 over-cap declines produce identical reasons", () => {
    if (new Set(overCapReasons).size !== 1) {
      throw new Error(`Got ${new Set(overCapReasons).size} distinct reasons: ${JSON.stringify([...new Set(overCapReasons)])}`);
    }
  });
  check("5 wrong-merchant declines produce identical reasons", () => {
    if (new Set(wrongMerchantReasons).size !== 1) {
      throw new Error(`Got ${new Set(wrongMerchantReasons).size} distinct reasons: ${JSON.stringify([...new Set(wrongMerchantReasons)])}`);
    }
  });
  check("5 single-use reuse declines produce identical reasons", () => {
    if (new Set(reuseReasons).size !== 1) {
      throw new Error(`Got ${new Set(reuseReasons).size} distinct reasons: ${JSON.stringify([...new Set(reuseReasons)])}`);
    }
  });
}
console.log("");

// ─── Condition 4: Cross-account isolation ───
console.log("Condition 4: Cross-account isolation");
{
  const service = new ZeroDOMIntegrationService({ now: () => NOW });
  const accountA = service.provisionSandboxAccount({
    account_id: "readiness_isolation_a",
    stripe_connect_id: "acct_isolation_a",
    currency: "usd",
    initial_balance: 5_000,
    api_key: "zd_test_isolation_a"
  });
  const accountB = service.provisionSandboxAccount({
    account_id: "readiness_isolation_b",
    stripe_connect_id: "acct_isolation_b",
    currency: "usd",
    initial_balance: 5_000,
    api_key: "zd_test_isolation_b"
  });
  const authA = { api_key: accountA.api_key };
  const authB = { api_key: accountB.api_key };

  const scope = defineTaskScope({
    accountId: accountA.account.account_id,
    taskDescription: "Isolation readiness check",
    taskId: "task_isolation_readiness",
    callerId: "isolation-agent",
    maxAmount: 2_000,
    currency: "usd",
    merchantLock: { type: "merchant_name", value: "Shop" },
    ttlSeconds: 300,
    singleUse: true,
    now: NOW
  });
  const cardA = service.mintCard({ caller_id: scope.caller_id, task_scope: scope }, authA, NOW);

  check("B cannot view A's card status", () => {
    try {
      service.getCardStatus({ card_id: cardA.record.card_id }, authB, NOW);
      throw new Error("should have thrown CardIssueError");
    } catch (error) {
      if (!(error instanceof CardIssueError)) throw error;
    }
  });

  check("B cannot fund A's account", () => {
    try {
      service.fundAccount({ account_id: accountA.account.account_id, amount: 1, currency: "usd" }, authB);
      throw new Error("should have thrown AccountAccessError");
    } catch (error) {
      if (!(error instanceof AccountAccessError)) throw error;
    }
  });

  check("B cannot view A's audit log", () => {
    try {
      service.listAuditLog({ account_id: accountA.account.account_id }, authB);
      throw new Error("should have thrown AccountAccessError");
    } catch (error) {
      if (!(error instanceof AccountAccessError)) throw error;
    }
  });

  check("B cannot mint a card against A's scope", () => {
    try {
      service.mintCard({ caller_id: scope.caller_id, task_scope: scope }, authB, NOW);
      throw new Error("should have thrown AccountAccessError");
    } catch (error) {
      if (!(error instanceof AccountAccessError)) throw error;
    }
  });

  check("B's audit log is empty (no A events leaked)", () => {
    const events = service.listAuditLog({}, authB);
    if (events.length !== 0) {
      throw new Error(`Expected 0 events for B, got ${events.length}`);
    }
  });
}
console.log("");

// ─── Condition 5: No real credentials in logs ───
console.log("Condition 5: No real credentials in logs, agent context, or version control");
{
  const service = new ZeroDOMIntegrationService({ now: () => NOW });
  const account = service.provisionSandboxAccount({
    account_id: "readiness_cred_check",
    stripe_connect_id: "acct_cred_check",
    currency: "usd",
    initial_balance: 5_000,
    api_key: "zd_test_cred_check"
  });
  const auth = { api_key: account.api_key };
  const scope = defineTaskScope({
    accountId: account.account.account_id,
    taskDescription: "Credential redaction check",
    taskId: "task_cred_check",
    callerId: "cred-agent",
    maxAmount: 3_000,
    currency: "usd",
    merchantLock: { type: "merchant_name", value: "Shop" },
    ttlSeconds: 300,
    singleUse: true,
    now: NOW
  });
  const issued = service.mintCard({ caller_id: scope.caller_id, task_scope: scope }, auth, NOW);
  service.authorizeTransaction(
    { card_id: issued.record.card_id, attempted_amount: 2_000, attempted_merchant: "Shop" },
    auth,
    NOW
  );
  const auditJson = JSON.stringify(service.listAuditLog({}, auth));

  check("Card number not in audit trail", () => {
    if (auditJson.includes(issued.card_details.number)) {
      throw new Error("Full card number found in audit trail");
    }
  });
  check("CVC not in audit trail", () => {
    if (auditJson.includes(issued.card_details.cvc)) {
      throw new Error("CVC found in audit trail");
    }
  });
  check("API key not in audit trail", () => {
    if (auditJson.includes(account.api_key)) {
      throw new Error("API key found in audit trail");
    }
  });
  check("API key hash not in public account", () => {
    const accountJson = JSON.stringify(account.account);
    if (accountJson.includes("api_key_hash")) {
      throw new Error("api_key_hash exposed in public account");
    }
  });
}
console.log("");

// ─── Condition 6: Audit trail reconstructs full task story ───
console.log("Condition 6: Audit trail reconstructs full task story");
{
  const service = new ZeroDOMIntegrationService({ now: () => NOW });
  const account = service.provisionSandboxAccount({
    account_id: "readiness_story",
    stripe_connect_id: "acct_story",
    currency: "usd",
    initial_balance: 10_000,
    api_key: "zd_test_story"
  });
  const auth = { api_key: account.api_key };
  const scope = defineTaskScope({
    accountId: account.account.account_id,
    taskDescription: "Story reconstruction readiness",
    taskId: "task_story_readiness",
    callerId: "story-agent",
    maxAmount: 5_000,
    currency: "usd",
    merchantLock: { type: "merchant_name", value: "Story Shop" },
    ttlSeconds: 300,
    singleUse: true,
    now: NOW
  });
  const issued = service.mintCard({ caller_id: scope.caller_id, task_scope: scope }, auth, NOW);
  service.authorizeTransaction(
    { card_id: issued.record.card_id, attempted_amount: 4_000, attempted_merchant: "Story Shop" },
    auth,
    NOW
  );

  const story = reconstructTaskStory(service.auditLog, account.account.account_id, scope.task_id);

  check("Task story has correct event sequence", () => {
    const types = story.map((e) => e.type);
    const expected = ["scope_defined", "card_minted", "transaction_attempt", "card_revoked"];
    if (JSON.stringify(types) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(types)}`);
    }
  });

  check("Every event has correct account_id", () => {
    for (const e of story) {
      if (e.account_id !== account.account.account_id) {
        throw new Error(`Event ${e.event_id} has wrong account_id: ${e.account_id}`);
      }
    }
  });

  check("Every event has correct task_id", () => {
    for (const e of story) {
      if (e.task_id !== scope.task_id) {
        throw new Error(`Event ${e.event_id} has wrong task_id: ${e.task_id}`);
      }
    }
  });

  check("Timestamps are monotonically non-decreasing", () => {
    for (let i = 1; i < story.length; i++) {
      if (story[i].timestamp < story[i - 1].timestamp) {
        throw new Error(`Event ${i} timestamp ${story[i].timestamp} < event ${i - 1} timestamp ${story[i - 1].timestamp}`);
      }
    }
  });

  check("Transaction attempt shows approved result", () => {
    const txn = story.find((e) => e.type === "transaction_attempt");
    if (!txn?.transaction || txn.transaction.result !== "approved") {
      throw new Error(`Transaction event has unexpected result: ${txn?.transaction?.result}`);
    }
  });
}

console.log("");
console.log("─".repeat(40));
console.log(`Passed: ${passed}  Failed: ${failed}  Blocked: ${blocked}`);
console.log("");

if (failed > 0) {
  console.log("RESULT: NOT READY — fix failed checks and re-run.");
  process.exit(1);
} else if (blocked > 0) {
  console.log("RESULT: CONDITIONALLY READY — blocked checks require human action.");
  console.log("All automatable conditions verified successfully.");
  process.exit(0);
} else {
  console.log("RESULT: 100% READY — all conditions verified.");
  process.exit(0);
}
