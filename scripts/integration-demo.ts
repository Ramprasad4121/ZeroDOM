import { ZeroDOMIntegrationService, defineTaskScope, handleMcpJsonRpc } from "../src/core/index.js";

const now = new Date();
const service = new ZeroDOMIntegrationService();
const account = service.provisionSandboxAccount({
  account_id: "account_integration_demo",
  stripe_connect_id: "acct_integration_demo",
  currency: "usd",
  initial_balance: 5_000,
  api_key: "zd_test_integration_demo"
});
const scope = defineTaskScope({
  accountId: account.account.account_id,
  taskDescription: "Any agent can mint a scoped card without browser coupling",
  taskId: `task_integration_demo_${Date.now()}`,
  callerId: "codex-demo-agent",
  maxAmount: 5_000,
  currency: "usd",
  merchantLock: { type: "merchant_category", value: "computer_software_stores" },
  ttlSeconds: 300,
  now
});

const issued = service.mintCard({
  caller_id: "codex-demo-agent",
  task_scope: scope
}, { api_key: account.api_key }, now);
const authorization = service.authorizeTransaction(
  {
    card_id: issued.record.card_id,
    attempted_amount: 4_200,
    attempted_merchant: "Sandbox Laptop Store",
    attempted_merchant_category: "computer_software_stores"
  },
  { api_key: account.api_key },
  now
);
const status = service.getCardStatus({ card_id: issued.record.card_id }, { api_key: account.api_key }, now);
const mcpList = await handleMcpJsonRpc(service, {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list"
});

console.log("ZeroDOM integration layer demo");
console.log("------------------------------");
console.log(`caller=${scope.caller_id}`);
console.log(`card=${issued.record.card_id} last4=${issued.card_details.last4}`);
console.log(`authorization=${authorization.result}`);
console.log(`status=${status.card.status}`);
console.log(`audit_events=${service.listAuditLog({ caller_id: scope.caller_id }, { api_key: account.api_key }).map((event) => event.type).join(",")}`);
console.log(`mcp_tools=${JSON.stringify(mcpList).match(/"name":/g)?.length ?? 0}`);
