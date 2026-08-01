import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AuditEvent, CardRecord, CardStatus, TaskScope, TransactionAttempt, TransactionResult } from "./models.js";

export interface AuditLog {
  recordScopeDefined(scope: TaskScope, now?: Date): void;
  recordCardMinted(scope: TaskScope, card: CardRecord, now?: Date): void;
  recordTransaction(scope: TaskScope, attempt: TransactionAttempt): void;
  recordCardExpired(scope: TaskScope, card: CardRecord, reason: string, now?: Date): void;
  recordCardRevoked(scope: TaskScope, card: CardRecord, reason: string, now?: Date): void;
  byAccount(accountId: string): AuditEvent[];
  byTask(accountId: string, taskId: string): AuditEvent[];
  byCard(accountId: string, cardId: string): AuditEvent[];
  byOutcome(accountId: string, result: TransactionResult): AuditEvent[];
  byCaller(accountId: string, callerId: string): AuditEvent[];
}

export class InMemoryAuditLog implements AuditLog {
  protected events: AuditEvent[] = [];
  #sequence = 0;

  recordScopeDefined(scope: TaskScope, now = new Date()) {
    this.#record({
      type: "scope_defined",
      account_id: scope.account_id,
      task_id: scope.task_id,
      caller_id: scope.caller_id,
      timestamp: now.toISOString(),
      scope
    });
  }

  recordCardMinted(scope: TaskScope, card: CardRecord, now = new Date()) {
    this.#record({
      type: "card_minted",
      account_id: scope.account_id,
      task_id: scope.task_id,
      caller_id: scope.caller_id,
      card_id: card.card_id,
      timestamp: now.toISOString(),
      scope,
      card_status: card.status
    });
  }

  recordTransaction(scope: TaskScope, attempt: TransactionAttempt) {
    this.#record({
      type: "transaction_attempt",
      account_id: scope.account_id,
      task_id: scope.task_id,
      caller_id: scope.caller_id,
      card_id: attempt.card_id,
      timestamp: attempt.timestamp,
      scope,
      transaction: attempt
    });
  }

  recordCardExpired(scope: TaskScope, card: CardRecord, reason: string, now = new Date()) {
    this.#record({
      type: "card_expired",
      account_id: scope.account_id,
      task_id: scope.task_id,
      caller_id: scope.caller_id,
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
      account_id: scope.account_id,
      task_id: scope.task_id,
      caller_id: scope.caller_id,
      card_id: card.card_id,
      timestamp: now.toISOString(),
      scope,
      card_status: card.status,
      reason
    });
  }

  byAccount(accountId: string) {
    return this.events.filter((event) => event.account_id === accountId).map((event) => structuredClone(event));
  }

  byTask(accountId: string, taskId: string) {
    return this.byAccount(accountId).filter((event) => event.task_id === taskId);
  }

  byCard(accountId: string, cardId: string) {
    return this.byAccount(accountId).filter((event) => event.card_id === cardId);
  }

  byOutcome(accountId: string, result: TransactionResult) {
    return this.byAccount(accountId).filter((event) => event.transaction?.result === result);
  }

  byCaller(accountId: string, callerId: string) {
    return this.byAccount(accountId).filter((event) => event.caller_id === callerId);
  }

  #record(event: Omit<AuditEvent, "event_id">) {
    this.#sequence += 1;
    this.events.push({
      ...event,
      event_id: `audit_${String(this.#sequence).padStart(6, "0")}`
    });
  }
}

export class FileAuditLog implements AuditLog {
  #sequence = 0;

  constructor(readonly filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.#sequence = this.#loadEvents().reduce((max, event) => Math.max(max, parseAuditSequence(event.event_id)), 0);
  }

  recordScopeDefined(scope: TaskScope, now = new Date()) {
    this.#record({
      type: "scope_defined",
      account_id: scope.account_id,
      task_id: scope.task_id,
      caller_id: scope.caller_id,
      timestamp: now.toISOString(),
      scope
    });
  }

  recordCardMinted(scope: TaskScope, card: CardRecord, now = new Date()) {
    this.#record({
      type: "card_minted",
      account_id: scope.account_id,
      task_id: scope.task_id,
      caller_id: scope.caller_id,
      card_id: card.card_id,
      timestamp: now.toISOString(),
      scope,
      card_status: card.status
    });
  }

  recordTransaction(scope: TaskScope, attempt: TransactionAttempt) {
    this.#record({
      type: "transaction_attempt",
      account_id: scope.account_id,
      task_id: scope.task_id,
      caller_id: scope.caller_id,
      card_id: attempt.card_id,
      timestamp: attempt.timestamp,
      scope,
      transaction: attempt
    });
  }

  recordCardExpired(scope: TaskScope, card: CardRecord, reason: string, now = new Date()) {
    this.#record({
      type: "card_expired",
      account_id: scope.account_id,
      task_id: scope.task_id,
      caller_id: scope.caller_id,
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
      account_id: scope.account_id,
      task_id: scope.task_id,
      caller_id: scope.caller_id,
      card_id: card.card_id,
      timestamp: now.toISOString(),
      scope,
      card_status: card.status,
      reason
    });
  }

  byAccount(accountId: string) {
    return this.#loadEvents()
      .filter((event) => event.account_id === accountId)
      .map((event) => structuredClone(event));
  }

  byTask(accountId: string, taskId: string) {
    return this.byAccount(accountId).filter((event) => event.task_id === taskId);
  }

  byCard(accountId: string, cardId: string) {
    return this.byAccount(accountId).filter((event) => event.card_id === cardId);
  }

  byOutcome(accountId: string, result: TransactionResult) {
    return this.byAccount(accountId).filter((event) => event.transaction?.result === result);
  }

  byCaller(accountId: string, callerId: string) {
    return this.byAccount(accountId).filter((event) => event.caller_id === callerId);
  }

  #record(event: Omit<AuditEvent, "event_id">) {
    this.#sequence += 1;
    const persisted: AuditEvent = {
      ...event,
      event_id: `audit_${String(this.#sequence).padStart(6, "0")}`
    };
    appendFileSync(this.filePath, `${JSON.stringify(persisted)}\n`, { encoding: "utf8" });
  }

  #loadEvents() {
    if (!existsSync(this.filePath)) {
      return [];
    }
    const raw = readFileSync(this.filePath, "utf8").trim();
    if (!raw) {
      return [];
    }
    return raw.split("\n").map((line) => JSON.parse(line) as AuditEvent);
  }
}

export function reconstructTaskStory(auditLog: AuditLog, accountId: string, taskId: string) {
  return auditLog.byTask(accountId, taskId).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function statusFromOutcome(result: TransactionResult): CardStatus | null {
  if (result === "approved") return "used";
  if (result === "declined_expired") return "expired";
  return null;
}

function parseAuditSequence(eventId: string) {
  const match = /^audit_(\d+)$/.exec(eventId);
  return match ? Number(match[1]) : 0;
}
