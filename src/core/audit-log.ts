import type { AuditEvent, CardRecord, CardStatus, TaskScope, TransactionAttempt, TransactionResult } from "./models.js";

export class InMemoryAuditLog {
  #events: AuditEvent[] = [];
  #sequence = 0;

  recordScopeDefined(scope: TaskScope, now = new Date()) {
    this.#record({
      type: "scope_defined",
      task_id: scope.task_id,
      timestamp: now.toISOString(),
      scope
    });
  }

  recordCardMinted(scope: TaskScope, card: CardRecord, now = new Date()) {
    this.#record({
      type: "card_minted",
      task_id: scope.task_id,
      card_id: card.card_id,
      timestamp: now.toISOString(),
      scope,
      card_status: card.status
    });
  }

  recordTransaction(scope: TaskScope, attempt: TransactionAttempt) {
    this.#record({
      type: "transaction_attempt",
      task_id: scope.task_id,
      card_id: attempt.card_id,
      timestamp: attempt.timestamp,
      scope,
      transaction: attempt
    });
  }

  recordCardExpired(scope: TaskScope, card: CardRecord, reason: string, now = new Date()) {
    this.#record({
      type: "card_expired",
      task_id: scope.task_id,
      card_id: card.card_id,
      timestamp: now.toISOString(),
      scope,
      card_status: card.status,
      reason
    });
  }

  recordCardRevoked(scope: TaskScope, card: CardRecord, reason: string, now = new Date()) {
    this.#record({
      type: "card_revoked",
      task_id: scope.task_id,
      card_id: card.card_id,
      timestamp: now.toISOString(),
      scope,
      card_status: card.status,
      reason
    });
  }

  all() {
    return this.#events.map((event) => structuredClone(event));
  }

  byTask(taskId: string) {
    return this.all().filter((event) => event.task_id === taskId);
  }

  byCard(cardId: string) {
    return this.all().filter((event) => event.card_id === cardId);
  }

  byOutcome(result: TransactionResult) {
    return this.all().filter((event) => event.transaction?.result === result);
  }

  #record(event: Omit<AuditEvent, "event_id">) {
    this.#sequence += 1;
    this.#events.push({
      ...event,
      event_id: `audit_${String(this.#sequence).padStart(6, "0")}`
    });
  }
}

export function reconstructTaskStory(auditLog: InMemoryAuditLog, taskId: string) {
  return auditLog.byTask(taskId).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function statusFromOutcome(result: TransactionResult): CardStatus | null {
  if (result === "approved") return "used";
  if (result === "declined_expired") return "expired";
  return null;
}
