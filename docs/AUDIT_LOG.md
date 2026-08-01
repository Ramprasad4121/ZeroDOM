# Durable Audit Log

ZeroDOM includes an append-only JSONL audit log for reconstructing a task story after the process exits.

`FileAuditLog` writes one `AuditEvent` per line:

- `scope_defined`
- `card_minted`
- `transaction_attempt`
- `card_expired`
- `card_revoked`

The file can be reloaded and queried by account, task, card, outcome, and caller.
Every public audit query begins with `account_id`; there is no cross-account
query method.

## Demo

```bash
npm run audit-demo
# or
node bin/zerodome.js audit-demo
```

The demo writes a temporary JSONL file, reloads it through a new `FileAuditLog`,
and prints the event sequence. It prints only card ID and last4; full card
number and CVC are not part of audit events.

## Safety Rules

- Audit events must never include full card number or CVC.
- Audit events must include `caller_id` so multi-agent task histories can be
  reconstructed without external context.
- Audit events must include `account_id`; task reconstruction takes both the
  account and task ID, so the same task ID can safely exist in separate tenants.
- The audit path should be outside version control. Runtime `*.log` files are ignored, and demo JSONL files are written under the OS temp directory.
- Every declined transaction should include a specific `reason`, not a generic error string.
