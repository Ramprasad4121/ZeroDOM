import type { AuditLog } from "./audit-log.js";
import type { CardIssuerClient } from "./issuer.js";
import type { AuditEvent, CardRecord, TaskScope, TransactionAttempt } from "./models.js";

export interface DashboardCardSummary {
  account_id: string;
  card_id: string;
  task_id: string;
  caller_id: string;
  issuer_card_ref: string;
  status: CardRecord["status"];
  minted_at: string;
  scope: TaskScope;
  approved_amount: number;
  remaining_amount: number;
  authorization_count: number;
  last_result: TransactionAttempt["result"] | "none";
}

export interface DashboardSnapshot {
  account_id: string;
  generated_at: string;
  active_cards: DashboardCardSummary[];
  all_cards: DashboardCardSummary[];
  audit_events: AuditEvent[];
}

export function buildDashboardSnapshot({
  accountId,
  issuer,
  auditLog,
  now = new Date(),
  expireBeforeRead = true
}: {
  accountId: string;
  issuer: CardIssuerClient;
  auditLog: AuditLog;
  now?: Date;
  expireBeforeRead?: boolean;
}): DashboardSnapshot {
  if (expireBeforeRead) {
    issuer.expireCards(accountId, now);
  }

  const allCards = issuer.listCards(accountId).map((card) => summarizeCard(issuer, card));

  return {
    account_id: accountId,
    generated_at: now.toISOString(),
    active_cards: allCards.filter((card) => card.status === "active"),
    all_cards: allCards,
    audit_events: auditLog.byAccount(accountId)
  };
}

export function formatDashboardSnapshot(snapshot: DashboardSnapshot) {
  const lines = [
    "ZeroDOM Scoped-Card Dashboard",
    `generated_at=${snapshot.generated_at}`,
    "",
    "Active cards"
  ];

  if (snapshot.active_cards.length === 0) {
    lines.push("- none");
  } else {
    for (const card of snapshot.active_cards) {
      lines.push(
        `- ${card.card_id} task=${card.task_id} caller=${card.caller_id} status=${card.status} remaining=${formatMinor(card.remaining_amount, card.scope.currency)} lock=${card.scope.merchant_lock.type}:${card.scope.merchant_lock.value}`
      );
    }
  }

  lines.push("", "Audit trail");
  if (snapshot.audit_events.length === 0) {
    lines.push("- none");
  } else {
    for (const event of snapshot.audit_events) {
      const result = event.transaction ? ` result=${event.transaction.result}` : "";
      const card = event.card_id ? ` card=${event.card_id}` : "";
      lines.push(`- ${event.timestamp} ${event.type} task=${event.task_id} caller=${event.caller_id}${card}${result}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function summarizeCard(issuer: CardIssuerClient, card: CardRecord): DashboardCardSummary {
  const scope = issuer.getScopeForCard(card.card_id, card.account_id);
  const history = issuer.getStatusAndHistory(card.card_id, card.account_id);
  const approvedAmount = history.attempts
    .filter((attempt) => attempt.result === "approved")
    .reduce((total, attempt) => total + attempt.attempted_amount, 0);
  const lastAttempt = history.attempts.at(-1);

  return {
    ...card,
    caller_id: scope.caller_id,
    scope,
    approved_amount: approvedAmount,
    remaining_amount: Math.max(0, scope.max_amount - approvedAmount),
    authorization_count: history.attempts.length,
    last_result: lastAttempt?.result ?? "none"
  };
}

function formatMinor(amount: number, currency: string) {
  return `${currency.toUpperCase()} ${(amount / 100).toFixed(2)}`;
}
