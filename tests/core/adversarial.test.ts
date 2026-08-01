import { describe, expect, it } from "vitest";
import {
  AccountAccessError,
  CardIssueError,
  SandboxCardIssuerClient,
  ZeroDOMIntegrationService,
  defineTaskScope,
  handleZeroDOMRestOperation
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

describe("adversarial account-level behavior", () => {
  it("rejects card minting for a suspended account", () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });

    const suspendedAccount = service.accounts.createAccount({
      accountId: "account_suspended_2",
      stripeConnectId: "acct_suspended_test_2",
      currency: "usd",
      initialBalance: 5_000,
      apiKey: "zd_test_suspended_acct_2",
      status: "suspended"
    });

    const scope = defineTaskScope({
      accountId: "account_suspended_2",
      taskDescription: "Should fail because account is suspended",
      taskId: "task_suspended",
      callerId: "adversarial-agent",
      maxAmount: 2_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Example Shop" },
      ttlSeconds: 300,
      now: NOW
    });

    expect(() =>
      service.mintCard(
        { caller_id: scope.caller_id, task_scope: scope },
        { api_key: suspendedAccount.api_key }
      )
    ).toThrow(AccountAccessError);
    expect(service.issuer.listCards("account_suspended_2")).toHaveLength(0);
  });

  it("returns proper HTTP status codes for cross-account REST access attempts", async () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const accountA = service.provisionSandboxAccount({
      account_id: "account_rest_a",
      stripe_connect_id: "acct_rest_a",
      currency: "usd",
      initial_balance: 5_000,
      api_key: "zd_test_rest_a"
    });
    const accountB = service.provisionSandboxAccount({
      account_id: "account_rest_b",
      stripe_connect_id: "acct_rest_b",
      currency: "usd",
      initial_balance: 5_000,
      api_key: "zd_test_rest_b"
    });
    const headersA = { authorization: `Bearer ${accountA.api_key}` };
    const headersB = { authorization: `Bearer ${accountB.api_key}` };

    const scopeA = defineTaskScope({
      accountId: accountA.account.account_id,
      taskDescription: "REST isolation test",
      taskId: "task_rest_isolation",
      callerId: "rest-agent-a",
      maxAmount: 2_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Shop" },
      ttlSeconds: 300,
      now: NOW
    });
    const mintResult = await handleZeroDOMRestOperation(service, {
      method: "POST",
      path: "/v1/cards",
      headers: headersA,
      body: { caller_id: scopeA.caller_id, task_scope: scopeA }
    });
    expect(mintResult.statusCode).toBe(201);
    const cardId = (mintResult.payload as { record: { card_id: string } }).record.card_id;

    const crossStatus = await handleZeroDOMRestOperation(service, {
      method: "GET",
      path: `/v1/cards/${cardId}/status`,
      headers: headersB
    });
    expect(crossStatus.statusCode).toBe(404);

    const crossFund = await handleZeroDOMRestOperation(service, {
      method: "POST",
      path: "/v1/accounts/account_rest_a/fund",
      headers: headersB,
      body: { amount: 1_000, currency: "usd" }
    });
    expect(crossFund.statusCode).toBe(403);

    const crossAudit = await handleZeroDOMRestOperation(service, {
      method: "GET",
      path: "/v1/audit-log",
      headers: headersB,
      query: { account_id: "account_rest_a" }
    });
    expect(crossAudit.statusCode).toBe(403);

    const noAuth = await handleZeroDOMRestOperation(service, {
      method: "GET",
      path: `/v1/cards/${cardId}/status`,
      headers: {}
    });
    expect(noAuth.statusCode).toBe(401);
  });
});
