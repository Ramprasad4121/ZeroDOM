import { chromium } from "playwright";
import { app } from "../src/server/mcp.js";
import type { Server } from "node:http";
import { sandboxIssuer } from "../src/core/issuer.js";

async function runDemo() {
  // Start server on a dynamic port
  let server: Server;
  let port: number;

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address();
      if (address && typeof address !== "string") {
        port = address.port;
      }
      resolve();
    });
  });

  console.log(`Test Merchant Server listening on port ${port}`);

  const browser = await chromium.launch({ headless: false, slowMo: 50 });

  // ----------------------------------------------------
  // Scenario 1: The Good Agent
  // ----------------------------------------------------
  console.log("\n--- Scenario 1: The Good Agent ---");
  let cardId1: string | null = null;
  try {
    const expiresAt = new Date(Date.now() + 600 * 1000).toISOString();
    // Call ZeroDOM to mint a $25 card
    const mintResponse = await fetch(`http://127.0.0.1:${port}/request_task_card`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: "account_local",
        task_id: "task_good_agent",
        max_amount: 2500, // $25 in cents
        currency: "usd",
        merchant_lock: { type: "merchant_name", value: "TestStore" },
        expires_at: expiresAt
      })
    });

    const card = await mintResponse.json();
    cardId1 = card.record.card_id;
    console.log(`Minted Scoped Card: ${cardId1} (PAN: ${card.card_details.number})`);

    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/checkout`);

    // Fill form
    await page.fill("#merchant", "TestStore");
    await page.fill("#amount", "2500");
    await page.fill("#card-number", card.card_details.number);
    await page.fill("#exp-month", String(card.card_details.exp_month));
    await page.fill("#exp-year", String(card.card_details.exp_year));
    await page.fill("#cvc", card.card_details.cvc);

    // Click submit
    await page.click("#submit");

    // Verify success message
    await page.waitForSelector("#message");
    const msg = await page.innerText("#message");
    console.log(`Checkout result: ${msg}`);
    if (!msg.includes("Success")) {
      throw new Error(`Expected success, got: ${msg}`);
    }

    await page.close();
  } catch (err) {
    console.error(`Good Agent failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (cardId1) {
      console.log(`Revoking card: ${cardId1}`);
      sandboxIssuer.revokeCard(cardId1, "account_local", "Good Agent task finished");
    }
  }

  // ----------------------------------------------------
  // Scenario 2: The Hallucinating Agent (Overspend)
  // ----------------------------------------------------
  console.log("\n--- Scenario 2: The Hallucinating Agent ---");
  let cardId2: string | null = null;
  try {
    const expiresAt = new Date(Date.now() + 600 * 1000).toISOString();
    // Call ZeroDOM to mint a $5 card
    const mintResponse = await fetch(`http://127.0.0.1:${port}/request_task_card`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: "account_local",
        task_id: "task_hallucinating_agent",
        max_amount: 500, // $5 in cents
        currency: "usd",
        merchant_lock: { type: "merchant_name", value: "TestStore" },
        expires_at: expiresAt
      })
    });

    const card = await mintResponse.json();
    cardId2 = card.record.card_id;
    console.log(`Minted Scoped Card: ${cardId2} (PAN: ${card.card_details.number})`);

    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/checkout`);

    // Fill form - The Hallucination: Types 50000 cents ($500) instead of 500 cents ($5)
    await page.fill("#merchant", "TestStore");
    await page.fill("#amount", "50000"); // OVER LIMIT
    await page.fill("#card-number", card.card_details.number);
    await page.fill("#exp-month", String(card.card_details.exp_month));
    await page.fill("#exp-year", String(card.card_details.exp_year));
    await page.fill("#cvc", card.card_details.cvc);

    // Click submit
    await page.click("#submit");

    // Verify decline message
    await page.waitForSelector("#message");
    const msg = await page.innerText("#message");
    console.log(`Checkout result: ${msg}`);
    if (!msg.includes("declined_amount")) {
      throw new Error(`Expected declined_amount block, got: ${msg}`);
    }
    console.log("Decline block verified successfully (Security net active).");

    await page.close();
  } catch (err) {
    console.error(`Hallucinating Agent check failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (cardId2) {
      console.log(`Revoking card: ${cardId2}`);
      sandboxIssuer.revokeCard(cardId2, "account_local", "Hallucinating Agent task finished");
    }
  }

  // Cleanup browser and server
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  console.log("\nDemo complete. Server shut down.");
}

runDemo();
