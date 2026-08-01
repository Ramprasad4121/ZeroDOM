import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { app } from "../../src/server/mcp.js";
import type { Server } from "node:http";

describe("MCP/REST request_task_card Integration Tests", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        if (address && typeof address !== "string") {
          port = address.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("Test A (Happy Path): returns a card credential for a valid request", async () => {
    const expiresAt = new Date(Date.now() + 600 * 1000).toISOString();
    const response = await fetch(`http://127.0.0.1:${port}/request_task_card`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: "account_happy_path",
        task_id: "task_happy_path",
        max_amount: 2500, // $25 in cents
        currency: "usd",
        merchant_lock: { type: "merchant_name", value: "TestBookstore" },
        expires_at: expiresAt
      })
    });

    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.record).toBeDefined();
    expect(body.record.card_id).toBeDefined();
    expect(body.card_details.number).toBeDefined();
    expect(body.card_details.cvc).toBeDefined();
    expect(body.scope.max_amount).toBe(2500);
    expect(body.scope.merchant_lock.value).toBe("TestBookstore");
  });

  it("Test B (Adversarial): rejects request missing max_amount", async () => {
    const expiresAt = new Date(Date.now() + 600 * 1000).toISOString();
    const response = await fetch(`http://127.0.0.1:${port}/request_task_card`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: "account_adversarial",
        task_id: "task_adversarial",
        currency: "usd",
        merchant_lock: { type: "merchant_name", value: "TestBookstore" },
        expires_at: expiresAt
      })
    });

    expect(response.status).toBe(400);
    const body: any = await response.json();
    expect(body.error).toContain("max_amount");
  });

  it("fails immediately if account_id is missing", async () => {
    const expiresAt = new Date(Date.now() + 600 * 1000).toISOString();
    const response = await fetch(`http://127.0.0.1:${port}/request_task_card`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: "task_missing_account",
        max_amount: 1000,
        currency: "usd",
        merchant_lock: { type: "merchant_name", value: "TestBookstore" },
        expires_at: expiresAt
      })
    });

    expect(response.status).toBe(400);
    const body: any = await response.json();
    expect(body.error).toBe("account_id is required");
  });
});
