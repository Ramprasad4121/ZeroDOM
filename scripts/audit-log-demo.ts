import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FileAuditLog,
  SandboxCardIssuerClient,
  defineTaskScope,
  reconstructTaskStory
} from "../src/core/index.js";

const now = new Date();
const filePath = path.join(mkdtempSync(path.join(os.tmpdir(), "zerodom-audit-demo-")), "audit.jsonl");
const auditLog = new FileAuditLog(filePath);
const issuer = new SandboxCardIssuerClient({ auditLog });
const scope = defineTaskScope({
  taskDescription: "Durable audit log demo",
  taskId: `task_audit_demo_${Date.now()}`,
  callerId: "audit-demo-agent",
  maxAmount: 5_000,
  currency: "usd",
  merchantLock: { type: "merchant_name", value: "Sandbox Laptop Store" },
  ttlSeconds: 300,
  now
});
const issued = issuer.mintCard(scope, now);
const attempt = issuer.authorize(
  {
    account_id: issued.record.account_id,
    card_id: issued.record.card_id,
    attempted_amount: 4_200,
    attempted_merchant: "Sandbox Laptop Store"
  },
  now
);

const reloadedLog = new FileAuditLog(filePath);
const story = reconstructTaskStory(reloadedLog, scope.account_id, scope.task_id);
const raw = readFileSync(filePath, "utf8");

console.log("ZeroDOM durable audit log demo");
console.log("--------------------------------");
console.log(`audit_file=${filePath}`);
console.log(`caller=${scope.caller_id}`);
console.log(`authorization=${attempt.result} card=${issued.record.card_id} last4=${issued.card_details.last4}`);
console.log(`events=${story.map((event) => event.type).join(",")}`);
console.log(`raw_lines=${raw.trim().split("\n").length}`);
