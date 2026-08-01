import type { ScopeDefinitionInput, TaskScope } from "./models.js";

const TASK_ID_PREFIX = "task";

export class ScopeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeValidationError";
  }
}

export function defineTaskScope(input: ScopeDefinitionInput): TaskScope {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);

  const scope: TaskScope = {
    task_id: input.taskId ?? `${TASK_ID_PREFIX}_${crypto.randomUUID()}`,
    max_amount: input.maxAmount,
    currency: input.currency,
    merchant_lock: input.merchantLock,
    expires_at: expiresAt.toISOString(),
    single_use: input.singleUse ?? true
  };

  validateTaskScope(scope, now);
  return scope;
}

export function validateTaskScope(scope: Partial<TaskScope>, now = new Date()): asserts scope is TaskScope {
  if (!scope || typeof scope !== "object") {
    throw new ScopeValidationError("TaskScope is required");
  }
  if (!scope.task_id || typeof scope.task_id !== "string") {
    throw new ScopeValidationError("TaskScope.task_id is required");
  }
  if (typeof scope.max_amount !== "number" || !Number.isInteger(scope.max_amount) || scope.max_amount <= 0) {
    throw new ScopeValidationError("TaskScope.max_amount must be a positive integer in minor currency units");
  }
  if (!scope.currency || typeof scope.currency !== "string" || !/^[a-z]{3}$/.test(scope.currency)) {
    throw new ScopeValidationError("TaskScope.currency must be a lowercase ISO currency code");
  }
  if (!scope.merchant_lock || typeof scope.merchant_lock !== "object") {
    throw new ScopeValidationError("TaskScope.merchant_lock is required");
  }
  if (!["merchant_name", "merchant_category"].includes(scope.merchant_lock.type)) {
    throw new ScopeValidationError("TaskScope.merchant_lock.type must be merchant_name or merchant_category");
  }
  if (!scope.merchant_lock.value || typeof scope.merchant_lock.value !== "string" || !scope.merchant_lock.value.trim()) {
    throw new ScopeValidationError("TaskScope.merchant_lock.value is required");
  }
  if (!scope.expires_at || typeof scope.expires_at !== "string") {
    throw new ScopeValidationError("TaskScope.expires_at is required");
  }
  const expiresAt = new Date(scope.expires_at);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new ScopeValidationError("TaskScope.expires_at must be an ISO timestamp");
  }
  if (expiresAt.getTime() <= now.getTime()) {
    throw new ScopeValidationError("TaskScope.expires_at must be in the future");
  }
  if (typeof scope.single_use !== "boolean") {
    throw new ScopeValidationError("TaskScope.single_use must be boolean");
  }
}
