import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileAuditLog,
  SandboxCardIssuerClient,
  defineTaskScope,
  reconstructTaskStory
} from "../../src/core/index.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("FileAuditLog", () => {
  it("persists an append-only task story that can be reconstructed after reload", () => {
    const filePath = tempAuditPath();
    const auditLog = new FileAuditLog(filePath);
    const issuer = new SandboxCardIssuerClient({ auditLog });
    const scope = defineTaskScope({
      taskDescription: "Persist the audit story",
      taskId: "task_file_audit",
      callerId: "codex-agent",
      maxAmount: 5_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Example Shop" },
      ttlSeconds: 300,
      now: NOW
    });
    const issued = issuer.mintCard(scope, NOW);
    const approved = issuer.authorize(
      {
        account_id: issued.record.account_id,
        card_id: issued.record.card_id,
        attempted_amount: 4_200,
        attempted_merchant: "Example Shop"
      },
      NOW
    );
    const reloaded = new FileAuditLog(filePath);
    const story = reconstructTaskStory(reloaded, scope.account_id, scope.task_id);
    const rawLog = readFileSync(filePath, "utf8");

    expect(approved.result).toBe("approved");
    expect(story.map((event) => event.type)).toEqual([
      "scope_defined",
      "card_minted",
      "transaction_attempt",
      "card_revoked"
    ]);
    expect(reloaded.byCard(scope.account_id, issued.record.card_id)).toHaveLength(3);
    expect(reloaded.byOutcome(scope.account_id, "approved")).toHaveLength(1);
    expect(reloaded.byCaller(scope.account_id, "codex-agent")).toHaveLength(4);
    expect(rawLog.trim().split("\n")).toHaveLength(4);
    expect(rawLog).not.toContain(issued.card_details.number);
    expect(rawLog).not.toContain(issued.card_details.cvc);
  });

  it("continues audit sequence numbers after process restart", () => {
    const filePath = tempAuditPath();
    const first = new FileAuditLog(filePath);
    const firstIssuer = new SandboxCardIssuerClient({ auditLog: first });
    const firstScope = defineTaskScope({
      taskDescription: "First process",
      taskId: "task_file_audit_first",
      callerId: "claude-agent",
      maxAmount: 1_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Example Shop" },
      ttlSeconds: 300,
      now: NOW
    });
    firstIssuer.mintCard(firstScope, NOW);

    const second = new FileAuditLog(filePath);
    const secondIssuer = new SandboxCardIssuerClient({ auditLog: second });
    const secondScope = defineTaskScope({
      taskDescription: "Second process",
      taskId: "task_file_audit_second",
      callerId: "hermes-agent",
      maxAmount: 1_000,
      currency: "usd",
      merchantLock: { type: "merchant_name", value: "Example Shop" },
      ttlSeconds: 300,
      now: NOW
    });
    secondIssuer.mintCard(secondScope, NOW);

    expect(new FileAuditLog(filePath).byAccount(firstScope.account_id).map((event) => event.event_id)).toEqual([
      "audit_000001",
      "audit_000002",
      "audit_000003",
      "audit_000004"
    ]);
  });
});

function tempAuditPath() {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "zerodom-audit-")), "audit.jsonl");
}
