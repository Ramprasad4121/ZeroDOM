import type { CardRecord, TransactionAttempt } from "./models.js";
import * as fs from "node:fs";

export interface AuditLogEntry {
  log_id: string;
  account_id: string;
  card_id: string;
  timestamp: string;
  event_type: "mint" | "attempt" | "revocation";
  details: any;
}

export class AuditLogger {
  private logs: AuditLogEntry[] = [];
  private cardToAccountMap = new Map<string, string>();
  private logFilePath: string;

  constructor(logFilePath: string = "audit-log-hackathon.json") {
    this.logFilePath = logFilePath;
  }

  logMint(cardRecord: CardRecord) {
    this.cardToAccountMap.set(cardRecord.card_id, cardRecord.account_id);
    const entry: AuditLogEntry = {
      log_id: `log_${Math.random().toString(36).substring(2, 9)}`,
      account_id: cardRecord.account_id,
      card_id: cardRecord.card_id,
      timestamp: new Date().toISOString(),
      event_type: "mint",
      details: cardRecord
    };
    this.logs.push(entry);
    this.saveToFile();
  }

  logAttempt(transactionAttempt: TransactionAttempt) {
    this.cardToAccountMap.set(transactionAttempt.card_id, transactionAttempt.account_id);
    const entry: AuditLogEntry = {
      log_id: `log_${Math.random().toString(36).substring(2, 9)}`,
      account_id: transactionAttempt.account_id,
      card_id: transactionAttempt.card_id,
      timestamp: new Date().toISOString(),
      event_type: "attempt",
      details: transactionAttempt
    };
    this.logs.push(entry);
    this.saveToFile();
  }

  logRevocation(card_id: string, reason: string) {
    const account_id = this.cardToAccountMap.get(card_id) || "account_local";
    const entry: AuditLogEntry = {
      log_id: `log_${Math.random().toString(36).substring(2, 9)}`,
      account_id,
      card_id,
      timestamp: new Date().toISOString(),
      event_type: "revocation",
      details: { reason }
    };
    this.logs.push(entry);
    this.saveToFile();
  }

  getLogs(account_id?: string): AuditLogEntry[] {
    if (account_id) {
      return this.logs.filter(l => l.account_id === account_id);
    }
    return this.logs;
  }

  private saveToFile() {
    try {
      fs.writeFileSync(this.logFilePath, JSON.stringify(this.logs, null, 2), "utf8");
    } catch (err) {
      // Fail-safe silently if file writing is blocked in sandbox tests
    }
  }
}
