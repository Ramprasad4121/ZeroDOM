import { chromium } from "playwright";
import { SandboxCardIssuerClient, defineTaskScope } from "../src/core/index.js";
import { PlaywrightCheckoutExecutor } from "./example-client/playwright-checkout-executor.js";

const now = new Date();
const issuer = new SandboxCardIssuerClient();
const issued = issuer.mintCard(
  defineTaskScope({
    taskDescription: "Deterministic Playwright checkout harness",
    taskId: `task_playwright_harness_${Date.now()}`,
    callerId: "playwright-example-agent",
    maxAmount: 5_000,
    currency: "usd",
    merchantLock: { type: "merchant_category", value: "computer_software_stores" },
    ttlSeconds: 300,
    now
  }),
  now
);

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.setContent(`
    <!doctype html>
    <html lang="en">
      <head><meta charset="utf-8"><title>ZeroDOM Checkout Harness</title></head>
      <body>
        <main>
          <h1>Sandbox Laptop Store</h1>
          <div id="amount" data-amount-minor="4200">$42.00</div>
          <div id="merchant">Sandbox Laptop Store</div>
          <div id="category" data-merchantCategory="computer_software_stores"></div>
          <form>
            <input id="card-number" autocomplete="cc-number" />
            <input id="cvc" autocomplete="cc-csc" />
            <input id="exp-month" autocomplete="cc-exp-month" />
            <input id="exp-year" autocomplete="cc-exp-year" />
            <button id="submit" type="button">Pay</button>
          </form>
        </main>
      </body>
    </html>
  `);

  const executor = new PlaywrightCheckoutExecutor(issuer);
  const result = await executor.runCheckout({
    page,
    issuedCard: issued,
    selectors: {
      cardNumber: "#card-number",
      cvc: "#cvc",
      expMonth: "#exp-month",
      expYear: "#exp-year",
      submit: "#submit",
      amount: "#amount",
      merchant: "#merchant",
      merchantCategory: "#category"
    },
    now
  });

  console.log("ZeroDOM Playwright checkout harness");
  console.log("----------------------------------");
  console.log(`card=${issued.record.card_id} last4=${issued.card_details.last4}`);
  console.log(`authorization=${result.attempt.result} amount=${result.attempt.attempted_amount}`);
  console.log(`card_status=${result.card.status}`);
  console.log(`telemetry_events=${result.telemetry.map((event) => event.event).join(",")}`);
} finally {
  await browser.close();
}
