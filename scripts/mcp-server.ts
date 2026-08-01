import readline from "node:readline";
import { ZeroDOMIntegrationService, handleMcpJsonRpc } from "../src/core/index.js";

const apiKey = process.env.ZERODOM_MCP_API_KEY;
const stripeConnectId = process.env.ZERODOM_MCP_CONNECT_ACCOUNT_ID;
const initialBalance = Number(process.env.ZERODOM_MCP_INITIAL_BALANCE ?? "0");

if (!apiKey || !stripeConnectId || !Number.isInteger(initialBalance) || initialBalance < 0) {
  console.error(
    "Set ZERODOM_MCP_API_KEY=zd_test_..., ZERODOM_MCP_CONNECT_ACCOUNT_ID=acct_..., and optional non-negative ZERODOM_MCP_INITIAL_BALANCE."
  );
  process.exit(1);
}

const service = new ZeroDOMIntegrationService();
service.provisionSandboxAccount({
  account_id: "account_mcp_local",
  stripe_connect_id: stripeConnectId,
  currency: "usd",
  initial_balance: initialBalance,
  api_key: apiKey
});
const lines = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

lines.on("line", async (line) => {
  try {
    const response = await handleMcpJsonRpc(service, JSON.parse(line), { api_key: apiKey });
    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: error instanceof Error ? error.message : String(error)
        }
      })}\n`
    );
  }
});
