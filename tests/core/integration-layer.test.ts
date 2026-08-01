import { describe, expect, it } from "vitest";
import {
  AccountAccessError,
  CardIssueError,
  ZeroDOMIntegrationService,
  defineTaskScope,
  handleMcpJsonRpc,
  handleZeroDOMRestOperation
} from "../../src/core/index.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("ZeroDOM account-scoped integration layer", () => {
  it("signs up, funds, mints, authorizes, and audits through the browser-free REST surface", async () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const signup = await handleZeroDOMRestOperation(service, {
      method: "POST",
      path: "/v1/accounts",
      body: {
        account_id: "account_rest",
        stripe_connect_id: "acct_rest_sandbox",
        currency: "usd",
        api_key: "zd_test_rest_account"
      }
    });
    const credential = signup.payload as { account: { account_id: string; available_balance: number }; api_key: string };
    const headers = { authorization: `Bearer ${credential.api_key}` };

    const funding = await handleZeroDOMRestOperation(service, {
      method: "POST",
      path: "/v1/accounts/account_rest/fund",
      headers,
      body: { amount: 5_000, currency: "usd" }
    });
    const scope = makeScope("account_rest", "task_rest_integration", "codex-rest-agent", 4_500);
    const mint = await handleZeroDOMRestOperation(service, {
      method: "POST",
      path: "/v1/cards",
      headers,
      body: { caller_id: scope.caller_id, task_scope: scope }
    });
    const minted = mint.payload as { record: { account_id: string; card_id: string }; card_details: { number: string; cvc: string; last4: string } };
    const authorization = await handleZeroDOMRestOperation(service, {
      method: "POST",
      path: "/v1/authorizations",
      headers,
      body: {
        card_id: minted.record.card_id,
        attempted_amount: 4_200,
        attempted_merchant: "Sandbox Laptop Store",
        attempted_merchant_category: "computer_software_stores"
      }
    });
    const status = await handleZeroDOMRestOperation(service, {
      method: "GET",
      path: `/v1/cards/${minted.record.card_id}/status`,
      headers
    });
    const audit = await handleZeroDOMRestOperation(service, {
      method: "GET",
      path: "/v1/audit-log",
      headers,
      query: { caller_id: "codex-rest-agent", outcome: "approved" }
    });

    expect(signup.statusCode).toBe(201);
    expect(credential.account.available_balance).toBe(0);
    expect(JSON.stringify(signup.payload)).not.toContain("api_key_hash");
    expect(funding.statusCode).toBe(200);
    expect(mint.statusCode).toBe(201);
    expect(minted.record.account_id).toBe("account_rest");
    expect(minted.card_details.last4).toHaveLength(4);
    expect((authorization.payload as { result: string }).result).toBe("approved");
    expect((status.payload as { card: { status: string } }).card.status).toBe("used");
    expect((audit.payload as { events: Array<{ transaction?: { result: string } }> }).events).toHaveLength(1);
    expect(JSON.stringify(audit.payload)).not.toContain(minted.card_details.number);
    expect(JSON.stringify(audit.payload)).not.toContain(minted.card_details.cvc);
    expect(service.accounts.getAccount("account_rest").available_balance).toBe(800);
  });

  it("fails closed before minting when the authenticated account has no funded balance", () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const account = service.provisionSandboxAccount({
      account_id: "account_unfunded",
      stripe_connect_id: "acct_unfunded_sandbox",
      currency: "usd",
      api_key: "zd_test_unfunded_account"
    });
    const scope = makeScope(account.account.account_id, "task_unfunded", "codex-agent", 1_000);

    expect(() => service.mintCard({ caller_id: scope.caller_id, task_scope: scope }, { api_key: account.api_key })).toThrow(
      "insufficient funded balance"
    );
    expect(service.issuer.listCards(account.account.account_id)).toHaveLength(0);
  });

  it("expires orphaned cards and releases their reserved balance per account", () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const account = service.provisionSandboxAccount({
      account_id: "account_expiry",
      stripe_connect_id: "acct_expiry_sandbox",
      currency: "usd",
      initial_balance: 5_000,
      api_key: "zd_test_expiry_account"
    });
    const scope = defineTaskScope({
      accountId: account.account.account_id,
      taskDescription: "Agent process exits before checkout",
      taskId: "task_expiry_release",
      callerId: "expiry-agent",
      maxAmount: 2_000,
      currency: "usd",
      merchantLock: { type: "merchant_category", value: "computer_software_stores" },
      ttlSeconds: 1,
      now: NOW
    });
    const issued = service.mintCard({ caller_id: scope.caller_id, task_scope: scope }, { api_key: account.api_key }, NOW);

    expect(service.accounts.getAccount(account.account.account_id).available_balance).toBe(3_000);
    expect(service.expireDueCards(new Date("2026-08-01T00:00:02.000Z")).map((card) => card.card_id)).toEqual([
      issued.record.card_id
    ]);
    expect(service.accounts.getAccount(account.account.account_id).available_balance).toBe(5_000);
    expect(service.getCardStatus({ card_id: issued.record.card_id }, { api_key: account.api_key }, new Date("2026-08-01T00:00:02.000Z")).card.status).toBe(
      "expired"
    );
  });

  it("rejects every cross-account card, balance, and audit-log access attempt", () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const accountA = service.provisionSandboxAccount({
      account_id: "account_alpha",
      stripe_connect_id: "acct_alpha_sandbox",
      currency: "usd",
      initial_balance: 5_000,
      api_key: "zd_test_alpha_account"
    });
    const accountB = service.provisionSandboxAccount({
      account_id: "account_beta",
      stripe_connect_id: "acct_beta_sandbox",
      currency: "usd",
      initial_balance: 5_000,
      api_key: "zd_test_beta_account"
    });
    const alphaScope = makeScope(accountA.account.account_id, "shared_task_name", "alpha-agent", 2_000);
    const alphaCard = service.mintCard(
      { caller_id: alphaScope.caller_id, task_scope: alphaScope },
      { api_key: accountA.api_key },
      NOW
    );
    const betaScopeUsingSharedTask = makeScope(accountB.account.account_id, "shared_task_name", "beta-agent", 2_000);

    expect(() => service.getCardStatus({ card_id: alphaCard.record.card_id }, { api_key: accountB.api_key }, NOW)).toThrow(
      CardIssueError
    );
    expect(() =>
      service.mintCard({ caller_id: "beta-agent", task_scope: alphaScope }, { api_key: accountB.api_key }, NOW)
    ).toThrow(AccountAccessError);
    expect(() => service.fundAccount({ account_id: accountA.account.account_id, amount: 1, currency: "usd" }, { api_key: accountB.api_key })).toThrow(
      AccountAccessError
    );
    expect(() => service.listAuditLog({ account_id: accountA.account.account_id }, { api_key: accountB.api_key })).toThrow(
      AccountAccessError
    );
    expect(service.listAuditLog({}, { api_key: accountB.api_key })).toEqual([]);
    expect(service.mintCard({ caller_id: betaScopeUsingSharedTask.caller_id, task_scope: betaScopeUsingSharedTask }, { api_key: accountB.api_key }, NOW).record.account_id).toBe(
      accountB.account.account_id
    );
  });

  it("exposes only the authenticated account's tools through MCP", async () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const account = service.provisionSandboxAccount({
      account_id: "account_mcp",
      stripe_connect_id: "acct_mcp_sandbox",
      currency: "usd",
      initial_balance: 3_000,
      api_key: "zd_test_mcp_account"
    });
    const scope = makeScope(account.account.account_id, "task_mcp_integration", "claude-mcp-agent", 3_000);
    const initialized = await handleMcpJsonRpc(service, { jsonrpc: "2.0", id: 1, method: "initialize" });
    const tools = await handleMcpJsonRpc(service, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const unauthenticated = await handleMcpJsonRpc(service, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "mint_card", arguments: { caller_id: scope.caller_id, task_scope: scope } }
    });
    const minted = await handleMcpJsonRpc(
      service,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "mint_card", arguments: { caller_id: scope.caller_id, task_scope: scope } }
      },
      { api_key: account.api_key }
    );
    const cardId = readMcpJson(minted).record.card_id as string;
    const status = await handleMcpJsonRpc(
      service,
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "get_card_status", arguments: { card_id: cardId } }
      },
      { api_key: account.api_key }
    );

    expect(readRpcResult<{ serverInfo: { name: string } }>(initialized).serverInfo.name).toBe("zerodom");
    expect(readRpcResult<{ tools: Array<{ name: string }> }>(tools).tools.map((tool) => tool.name)).toEqual([
      "mint_card",
      "get_card_status",
      "authorize_transaction",
      "list_audit_log"
    ]);
    expect(readRpcResult<{ isError: boolean }>(unauthenticated).isError).toBe(true);
    expect(readMcpJson(status).card.card_id).toBe(cardId);
  });
});

describe("REST edge cases", () => {
  it("returns 200 from the health endpoint", async () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const result = await handleZeroDOMRestOperation(service, {
      method: "GET",
      path: "/health"
    });
    expect(result.statusCode).toBe(200);
    expect((result.payload as { ok: boolean }).ok).toBe(true);
  });

  it("returns 400 for malformed request bodies", async () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const result = await handleZeroDOMRestOperation(service, {
      method: "POST",
      path: "/v1/accounts",
      body: { stripe_connect_id: "" }
    });
    expect(result.statusCode).toBe(400);
  });

  it("returns 404 for unknown routes", async () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const result = await handleZeroDOMRestOperation(service, {
      method: "GET",
      path: "/v1/nonexistent"
    });
    expect(result.statusCode).toBe(404);
  });

  it("rejects duplicate account creation", async () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const first = await handleZeroDOMRestOperation(service, {
      method: "POST",
      path: "/v1/accounts",
      body: {
        account_id: "account_dup",
        stripe_connect_id: "acct_dup",
        currency: "usd",
        api_key: "zd_test_dup"
      }
    });
    expect(first.statusCode).toBe(201);

    const second = await handleZeroDOMRestOperation(service, {
      method: "POST",
      path: "/v1/accounts",
      body: {
        account_id: "account_dup",
        stripe_connect_id: "acct_dup2",
        currency: "usd",
        api_key: "zd_test_dup2"
      }
    });
    expect([400, 403]).toContain(second.statusCode);
  });
});

describe("MCP authorize_transaction tool", () => {
  it("completes a full mint-authorize-audit cycle via MCP", async () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const account = service.provisionSandboxAccount({
      account_id: "account_mcp_auth",
      stripe_connect_id: "acct_mcp_auth",
      currency: "usd",
      initial_balance: 5_000,
      api_key: "zd_test_mcp_auth"
    });
    const auth = { api_key: account.api_key };
    const scope = makeScope(account.account.account_id, "task_mcp_auth", "mcp-agent", 3_000);

    const minted = await handleMcpJsonRpc(
      service,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "mint_card", arguments: { caller_id: scope.caller_id, task_scope: scope } }
      },
      auth
    );
    const cardId = readMcpJson(minted).record.card_id as string;

    const authorized = await handleMcpJsonRpc(
      service,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "authorize_transaction",
          arguments: {
            card_id: cardId,
            attempted_amount: 2_500,
            attempted_merchant: "computer_software_stores",
            attempted_merchant_category: "computer_software_stores"
          }
        }
      },
      auth
    );
    expect(readMcpJson(authorized).result).toBe("approved");

    const auditResult = await handleMcpJsonRpc(
      service,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_audit_log", arguments: {} }
      },
      auth
    );
    const events = readMcpJson(auditResult).events;
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.some((e: { type: string }) => e.type === "transaction_attempt")).toBe(true);
  });

  it("lists authorize_transaction in tools/list", async () => {
    const service = new ZeroDOMIntegrationService({ now: () => NOW });
    const tools = await handleMcpJsonRpc(service, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const toolNames = readRpcResult<{ tools: Array<{ name: string }> }>(tools).tools.map((t) => t.name);
    expect(toolNames).toContain("authorize_transaction");
    expect(toolNames).toEqual(["mint_card", "get_card_status", "authorize_transaction", "list_audit_log"]);
  });
});

function makeScope(accountId: string, taskId: string, callerId: string, maxAmount: number) {
  return defineTaskScope({
    accountId,
    taskDescription: "Agent requests a scoped card through the integration layer",
    taskId,
    callerId,
    maxAmount,
    currency: "usd",
    merchantLock: { type: "merchant_category", value: "computer_software_stores" },
    ttlSeconds: 300,
    now: NOW
  });
}

function readMcpJson(response: Awaited<ReturnType<typeof handleMcpJsonRpc>>) {
  const result = readRpcResult<{ content: Array<{ text: string }>; isError?: boolean }>(response);
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0].text);
}

function readRpcResult<T>(response: Awaited<ReturnType<typeof handleMcpJsonRpc>>) {
  expect(response).not.toBeNull();
  if (!response || !("result" in response)) {
    throw new Error(`expected JSON-RPC result, got ${JSON.stringify(response)}`);
  }
  return response.result as T;
}

