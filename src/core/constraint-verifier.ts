import type { CardRecord, TaskScope, TransactionAttempt, TransactionRequest, TransactionResult } from "./models.js";

export interface VerificationInput {
  scope: TaskScope;
  card: CardRecord;
  request: TransactionRequest;
  priorAttempts: TransactionAttempt[];
  now?: Date;
}

export interface VerificationDecision {
  result: TransactionResult;
  reason: string;
}

export function verifyTransactionAttempt({
  scope,
  card,
  request,
  priorAttempts,
  now = new Date()
}: VerificationInput): VerificationDecision {
  if (card.status === "expired") {
    return decline("declined_expired", "card is already expired");
  }
  if (new Date(scope.expires_at).getTime() <= now.getTime()) {
    return decline("declined_expired", "task scope has expired");
  }
  if (card.status === "used" || card.status === "revoked") {
    return decline("declined_reused", `card status is ${card.status}`);
  }
  if (scope.single_use && priorAttempts.some((attempt) => attempt.result === "approved")) {
    return decline("declined_reused", "single-use card already has an approved authorization");
  }
  if (request.attempted_amount > scope.max_amount) {
    return decline("declined_amount", `attempted amount ${request.attempted_amount} exceeds cap ${scope.max_amount}`);
  }
  if (!merchantMatches(scope, request)) {
    return decline("declined_merchant", `merchant does not match ${scope.merchant_lock.type} lock`);
  }

  return {
    result: "approved",
    reason: "attempt is inside amount, merchant, expiry, and reuse constraints"
  };
}

function merchantMatches(scope: TaskScope, request: TransactionRequest) {
  if (scope.merchant_lock.type === "merchant_name") {
    return normalize(request.attempted_merchant) === normalize(scope.merchant_lock.value);
  }

  return normalize(request.attempted_merchant_category) === normalize(scope.merchant_lock.value);
}

function normalize(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

function decline(result: Exclude<TransactionResult, "approved">, reason: string): VerificationDecision {
  return { result, reason };
}
