// src/issuer.js
import { SandboxCardIssuerClient, defineTaskScope } from "./core/index.js";

// Instantiates a singleton Sandbox issuer to maintain card state across calls
export const sandboxIssuer = new SandboxCardIssuerClient();

/**
 * Mint a new sandbox virtual card scoped to task parameters.
 * @param {object} taskScope - Target task scope configuration
 * @returns {object} Payer details and card references
 */
export function mintCard(taskScope) {
  // Normalize and parse scope definition using core validation logic
  const scopeInput = {
    taskDescription: taskScope.taskDescription || "Playwright Autonomous Checkout",
    accountId: taskScope.account_id || "account_local",
    callerId: taskScope.caller_id || "playwright-agent",
    maxAmount: taskScope.max_amount || taskScope.maxAmount || 5000,
    currency: taskScope.currency || "usd",
    merchantLock: taskScope.merchant_lock || taskScope.merchantLock || { type: "merchant_category", value: "computer_software_stores" },
    ttlSeconds: taskScope.ttlSeconds || 300,
    singleUse: taskScope.single_use !== undefined ? taskScope.single_use : true
  };

  const scope = defineTaskScope(scopeInput);
  const issued = sandboxIssuer.mintCard(scope);

  return {
    card_id: issued.record.card_id,
    number: issued.card_details.number,
    cvc: issued.card_details.cvc,
    exp_month: issued.card_details.exp_month,
    exp_year: issued.card_details.exp_year,
    record: issued.record,
    scope: issued.scope,
    card_details: issued.card_details
  };
}

/**
 * Revoke/Deactivate a card immediately.
 * @param {string} cardId - Unique card identifier to destroy
 * @returns {object} Updated card record
 */
export function revokeCard(cardId) {
  return sandboxIssuer.revokeCard(cardId, "account_local", "Playwright autonomous flow finished");
}
