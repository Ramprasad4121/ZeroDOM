import express from "express";
import crypto from "node:crypto";
import { validateTaskScope } from "../core/scope.js";
import { mintCard, sandboxIssuer } from "../core/issuer.js";
import { verifyTransaction } from "../core/verifier.js";
import { AuditLogger } from "../core/audit.js";
import type { TaskScope } from "../core/models.js";

const app = express();
app.use(express.json());

const auditLogger = new AuditLogger("audit-log-hackathon.json");

function findCardByNumber(cardNumber: string) {
  const accounts = ["account_local", "account_happy_path", "account_adversarial"];
  for (const acc of accounts) {
    try {
      const cards = sandboxIssuer.listCards(acc);
      for (const card of cards) {
        const details = sandboxIssuer.getCardDetails(card.card_id, acc);
        if (details.number.replace(/\s/g, "") === cardNumber.replace(/\s/g, "")) {
          const scope = sandboxIssuer.getScopeForCard(card.card_id, acc);
          return { card, details, scope };
        }
      }
    } catch (e) {
      // Ignore missing account error in lookup loop
    }
  }
  return null;
}

/**
 * Mock Merchant Checkout page form.
 */
app.get("/checkout", (req: express.Request, res: express.Response) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>ZeroDOM Test Checkout</title>
      <style>
        body { font-family: monospace; background: #fff; color: #000; padding: 40px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; font-weight: bold; margin-bottom: 5px; }
        input { width: 100%; padding: 8px; border: 1px solid #000; }
        button { padding: 10px 20px; background: #000; color: #fff; border: none; cursor: pointer; font-weight: bold; }
        #message { margin-top: 20px; font-weight: bold; }
      </style>
    </head>
    <body>
      <h2>ZeroDOM Sandbox Merchant Checkout</h2>
      <hr/>
      <form id="checkout-form">
        <div class="form-group">
          <label for="merchant">Merchant Name</label>
          <input type="text" id="merchant" name="merchant" value="TestStore" />
        </div>
        <div class="form-group">
          <label for="amount">Amount (in cents)</label>
          <input type="number" id="amount" name="amount" value="2500" />
        </div>
        <div class="form-group">
          <label for="card-number">Card Number</label>
          <input type="text" id="card-number" name="card_number" placeholder="4242..." />
        </div>
        <div class="form-group">
          <label for="exp-month">Expiry Month</label>
          <input type="text" id="exp-month" name="exp_month" placeholder="MM" />
        </div>
        <div class="form-group">
          <label for="exp-year">Expiry Year</label>
          <input type="text" id="exp-year" name="exp_year" placeholder="YYYY" />
        </div>
        <div class="form-group">
          <label for="cvc">CVC</label>
          <input type="text" id="cvc" name="cvc" placeholder="123" />
        </div>
        <button type="submit" id="submit">Pay Now</button>
      </form>
      <div id="message"></div>

      <script>
        document.getElementById('checkout-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const msgDiv = document.getElementById('message');
          msgDiv.innerText = 'Processing...';

          const formData = new FormData(e.target);
          const data = Object.fromEntries(formData.entries());

          try {
            const res = await fetch('/charge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            });
            const result = await res.json();
            if (res.ok) {
              msgDiv.innerText = 'Success! Payment completed successfully.';
            } else {
              msgDiv.innerText = 'Error: ' + (result.error || 'Payment failed');
            }
          } catch (err) {
            msgDiv.innerText = 'Error: connection failed';
          }
        });
      </script>
    </body>
    </html>
  `);
});

/**
 * Charge endpoint simulating Visa/Mastercard network backed by Constraint Verifier.
 */
app.post("/charge", async (req: express.Request, res: express.Response) => {
  const { card_number, cvc, exp_month, exp_year, amount, merchant } = req.body;

  const cardInfo = findCardByNumber(card_number);
  if (!cardInfo) {
    res.status(400).json({ status: "declined", error: "card not found" });
    return;
  }

  const { card, details, scope } = cardInfo;

  // Verify details match
  if (
    details.cvc !== cvc ||
    String(details.exp_month) !== String(exp_month) ||
    String(details.exp_year).slice(-2) !== String(exp_year).slice(-2)
  ) {
    res.status(400).json({ status: "declined", error: "invalid card details" });
    return;
  }

  // Run Constraint Verifier
  const verification = verifyTransaction(scope, Number(amount), merchant);

  const attempt = {
    account_id: card.account_id,
    card_id: card.card_id,
    attempted_amount: Number(amount),
    attempted_merchant: merchant,
    timestamp: new Date().toISOString(),
    result: verification.status === "approved" ? "approved" : verification.status,
    reason: verification.status === "approved" ? "Transaction approved" : `Verification failed: ${verification.status}`
  } as any;

  // Log in Audit Log
  auditLogger.logAttempt(attempt);

  if (verification.status !== "approved") {
    res.status(400).json({ status: "declined", error: verification.status });
    return;
  }

  res.status(200).json({ status: "approved" });
});

/**
 * REST Endpoint for requesting a task card.
 * Accepts: account_id, task_id, max_amount, merchant_lock, and expires_at.
 */
app.post("/request_task_card", async (req: express.Request, res: express.Response) => {
  const body = req.body;

  // Hard Rule: Every request MUST include an account_id. Fail immediately if it is missing.
  if (!body || !body.account_id || typeof body.account_id !== "string" || !body.account_id.trim()) {
    res.status(400).json({ error: "account_id is required" });
    return;
  }

  try {
    // Construct the TaskScope using existing models
    const scope: TaskScope = {
      account_id: body.account_id,
      task_id: body.task_id || `task_${crypto.randomUUID()}`,
      caller_id: body.caller_id || "mcp-agent",
      max_amount: body.max_amount,
      currency: body.currency || "usd",
      merchant_lock: body.merchant_lock,
      expires_at: body.expires_at,
      single_use: body.single_use !== undefined ? body.single_use : true
    };

    // Run existing fail-closed validation
    validateTaskScope(scope);

    // Call mintCard
    const issuedCard = await mintCard(scope);

    // Log the minting
    auditLogger.logMint(issuedCard.record);

    res.status(200).json(issuedCard);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "validation or card issuing failed"
    });
  }
});

export { app };
export default app;
