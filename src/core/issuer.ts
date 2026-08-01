import { InMemoryAuditLog, statusFromOutcome } from "./audit-log.js";
import { verifyTransactionAttempt } from "./constraint-verifier.js";
import type { CardRecord, IssuedCard, SandboxCardDetails, TaskScope, TransactionAttempt, TransactionRequest } from "./models.js";
import { validateTaskScope } from "./scope.js";

export class CardIssueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardIssueError";
  }
}

export interface CardIssuerClient {
  mintCard(scope: TaskScope, now?: Date): IssuedCard;
  authorize(request: TransactionRequest, now?: Date): TransactionAttempt;
  getStatusAndHistory(cardId: string): { card: CardRecord; attempts: TransactionAttempt[] };
  getScopeForCard(cardId: string): TaskScope;
  listCards(): CardRecord[];
  listActiveCards(): CardRecord[];
  expireCards(now?: Date): CardRecord[];
  revokeCard(cardId: string, reason: string, now?: Date): CardRecord;
}

export class SandboxCardIssuerClient implements CardIssuerClient {
  readonly auditLog: InMemoryAuditLog;
  #scopes = new Map<string, TaskScope>();
  #cards = new Map<string, CardRecord>();
  #cardDetails = new Map<string, SandboxCardDetails>();
  #attempts = new Map<string, TransactionAttempt[]>();
  #taskCards = new Map<string, string>();
  #sequence = 0;

  constructor({ auditLog = new InMemoryAuditLog() }: { auditLog?: InMemoryAuditLog } = {}) {
    this.auditLog = auditLog;
  }

  mintCard(scope: TaskScope, now = new Date()): IssuedCard {
    validateTaskScope(scope, now);
    const existingCardId = this.#taskCards.get(scope.task_id);
    if (existingCardId) {
      throw new CardIssueError(`task ${scope.task_id} already has card ${existingCardId}`);
    }

    this.#sequence += 1;
    const cardId = `card_${String(this.#sequence).padStart(6, "0")}`;
    const record: CardRecord = {
      card_id: cardId,
      task_id: scope.task_id,
      issuer_card_ref: `sandbox_issuing_${cardId}`,
      status: "active",
      minted_at: now.toISOString()
    };
    const details = makeSandboxCardDetails(this.#sequence, now);

    this.#scopes.set(scope.task_id, structuredClone(scope));
    this.#cards.set(cardId, record);
    this.#cardDetails.set(cardId, details);
    this.#attempts.set(cardId, []);
    this.#taskCards.set(scope.task_id, cardId);
    this.auditLog.recordScopeDefined(scope, now);
    this.auditLog.recordCardMinted(scope, record, now);

    return {
      record: structuredClone(record),
      scope: structuredClone(scope),
      card_details: structuredClone(details)
    };
  }

  authorize(request: TransactionRequest, now = new Date()): TransactionAttempt {
    const card = this.#mustGetCard(request.card_id);
    const scope = this.#mustGetScope(card.task_id);
    const priorAttempts = this.#attempts.get(card.card_id) ?? [];
    const decision = verifyTransactionAttempt({
      scope,
      card,
      request,
      priorAttempts,
      now
    });
    const attempt: TransactionAttempt = {
      ...request,
      timestamp: now.toISOString(),
      result: decision.result,
      reason: decision.reason
    };

    priorAttempts.push(attempt);
    this.#attempts.set(card.card_id, priorAttempts);

    const nextStatus = statusFromOutcome(decision.result);
    if (nextStatus) {
      card.status = nextStatus;
    }
    this.auditLog.recordTransaction(scope, attempt);
    if (decision.result === "approved" && scope.single_use) {
      this.auditLog.recordCardRevoked(scope, card, "single-use task completed; no further authorizations allowed", now);
    }
    if (decision.result === "declined_expired") {
      card.status = "expired";
      this.auditLog.recordCardExpired(scope, card, decision.reason, now);
    }

    return structuredClone(attempt);
  }

  getStatusAndHistory(cardId: string) {
    return {
      card: structuredClone(this.#mustGetCard(cardId)),
      attempts: (this.#attempts.get(cardId) ?? []).map((attempt) => structuredClone(attempt))
    };
  }

  getScopeForCard(cardId: string) {
    const card = this.#mustGetCard(cardId);
    return structuredClone(this.#mustGetScope(card.task_id));
  }

  expireCards(now = new Date()) {
    const expired: CardRecord[] = [];
    for (const card of this.#cards.values()) {
      if (card.status !== "active") continue;
      const scope = this.#mustGetScope(card.task_id);
      if (new Date(scope.expires_at).getTime() <= now.getTime()) {
        card.status = "expired";
        this.auditLog.recordCardExpired(scope, card, "task expiry window passed", now);
        expired.push(structuredClone(card));
      }
    }
    return expired;
  }

  revokeCard(cardId: string, reason: string, now = new Date()) {
    const card = this.#mustGetCard(cardId);
    const scope = this.#mustGetScope(card.task_id);
    card.status = "revoked";
    this.auditLog.recordCardRevoked(scope, card, reason, now);
    return structuredClone(card);
  }

  listActiveCards() {
    return [...this.#cards.values()].filter((card) => card.status === "active").map((card) => structuredClone(card));
  }

  listCards() {
    return [...this.#cards.values()].map((card) => structuredClone(card));
  }

  getCardDetails(cardId: string) {
    const details = this.#cardDetails.get(cardId);
    if (!details) {
      throw new CardIssueError(`unknown card ${cardId}`);
    }
    return structuredClone(details);
  }

  #mustGetCard(cardId: string) {
    const card = this.#cards.get(cardId);
    if (!card) {
      throw new CardIssueError(`unknown card ${cardId}`);
    }
    return card;
  }

  #mustGetScope(taskId: string) {
    const scope = this.#scopes.get(taskId);
    if (!scope) {
      throw new CardIssueError(`unknown task scope ${taskId}`);
    }
    return scope;
  }
}

function makeSandboxCardDetails(sequence: number, now: Date): SandboxCardDetails {
  const base = `42424242${String(sequence).padStart(7, "0")}`;
  const number = `${base}${luhnCheckDigit(base)}`;
  const expYear = now.getUTCFullYear() + 2;

  return {
    number,
    cvc: String(100 + (sequence % 900)).padStart(3, "0"),
    exp_month: 12,
    exp_year: expYear,
    last4: number.slice(-4)
  };
}

function luhnCheckDigit(value: string) {
  const sum = [...value, "0"]
    .reverse()
    .map(Number)
    .reduce((total, digit, index) => {
      if (index % 2 === 1) {
        const doubled = digit * 2;
        return total + (doubled > 9 ? doubled - 9 : doubled);
      }
      return total + digit;
    }, 0);
  return String((10 - (sum % 10)) % 10);
}
