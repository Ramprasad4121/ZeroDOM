import express from "express";
import crypto from "node:crypto";
import { validateTaskScope } from "../core/scope.js";
import { mintCard } from "../core/issuer.js";
import type { TaskScope } from "../core/models.js";

const app = express();
app.use(express.json());

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

    res.status(200).json(issuedCard);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "validation or card issuing failed"
    });
  }
});

export { app };
export default app;
