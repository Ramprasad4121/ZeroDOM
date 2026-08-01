import type { TaskScope } from "./models.js";

export interface VerificationResult {
  status: "approved" | "declined_amount" | "declined_merchant" | "declined_expired";
}

/**
 * Defense-in-depth constraint verifier running at the application level.
 */
export function verifyTransaction(
  scope: TaskScope,
  attemptedAmount: number,
  attemptedMerchant: string,
  now = new Date()
): VerificationResult {
  // 1. Amount constraint verification
  if (attemptedAmount > scope.max_amount) {
    return { status: "declined_amount" };
  }

  // 2. Expiry verification
  const expiresAt = new Date(scope.expires_at);
  if (now > expiresAt) {
    return { status: "declined_expired" };
  }

  // 3. Merchant Lock verification (fuzzy matching name/category value)
  const normAttempted = attemptedMerchant.toLowerCase().trim();
  const normLocked = scope.merchant_lock.value.toLowerCase().trim();

  const isMatch = normAttempted.includes(normLocked) || normLocked.includes(normAttempted);
  if (!isMatch) {
    return { status: "declined_merchant" };
  }

  return { status: "approved" };
}
