<p align="center">
  <h1 align="center">ZeroDOM</h1>
  <p align="center">
    <strong>Agent-Agnostic Scoped Autonomous Payments</strong>
    <br />
    Issuer-enforced virtual cards for AI agents. Zero trust. Zero overspend.
  </p>
  <p align="center">
    <a href="#quickstart">Quickstart</a> ·
    <a href="#how-it-works">How It Works</a> ·
    <a href="#api-reference">API</a> ·
    <a href="#mcp-integration">MCP</a> ·
    <a href="#stripe-integration">Stripe</a> ·
    <a href="#copy-paste-prompt">Agent Prompt</a>
  </p>
</p>

---

## The Problem

Giving an AI agent a credit card is dangerous. Agents hallucinate, get prompt-injected, and make mistakes. If your agent types `$500` instead of `$5`, your real card gets charged — and there's no undo.

**ZeroDOM fixes this.** It mints single-use, tightly scoped virtual payment cards where the spending constraints are enforced at the **bank/issuer level**, completely outside the agent's reasoning loop. If the agent tries to overspend, buy from the wrong merchant, or reuse a card — the transaction is **declined by the card network**, not by application code the agent could bypass.

## How It Works

```
Agent: "I need to buy a $25 charger from BestBuy"
                    │
                    ▼
         ┌─────────────────────┐
         │   ZeroDOM Scope     │  ← $25 cap, BestBuy only, 5-min expiry, single-use
         └─────────┬───────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │  Virtual Card Mint  │  ← Stripe Issuing (or local sandbox)
         └─────────┬───────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │  Agent Checks Out   │  ← Uses card on merchant site (Playwright, etc.)
         └─────────┬───────────┘
                    │
          ┌────────┴────────┐
          │                 │
    ✅ $25 @ BestBuy    ❌ $500 @ AnyStore
      APPROVED            DECLINED BY ISSUER
          │                 │
          ▼                 ▼
    Card auto-revoked   Card stays active
    Funds settled       No money moved
          │                 │
          └────────┬────────┘
                   ▼
         ┌─────────────────────┐
         │   Audit Trail       │  ← Append-only JSONL, PAN/CVC redacted
         └─────────────────────┘
```

## Key Features

| Feature | Description |
|---------|-------------|
| **Issuer-Level Enforcement** | Amount caps, merchant category locks, expiry windows, and single-use flags are enforced by Stripe Issuing — not by application code |
| **Agent-Agnostic** | Works with Claude, GPT, Codex, Gemini, Hermes, or any custom agent via REST API or MCP |
| **Multi-Tenant Isolation** | Each account has its own balance, cards, and audit trail. Account A can never see or touch Account B's data |
| **Dual Card Issuers** | Local sandbox (generates Luhn-valid test cards) or real Stripe Issuing (virtual Visa/Mastercard) |
| **Defense-in-Depth Verifier** | Application-level constraint checks run in parallel with bank-level controls for double safety |
| **Durable Audit Log** | Append-only JSONL trail with full task story reconstruction. PAN/CVC never stored |
| **MCP Server** | Native Model Context Protocol tools for Claude Desktop, Cursor, Windsurf, and any MCP client |
| **Grayscale CLI Dashboard** | Real-time terminal dashboard for monitoring active cards and audit events |

---

## Quickstart

### Prerequisites

- **Node.js** ≥ 20
- **npm** (included with Node.js)

### Install & Verify

```bash
git clone https://github.com/Ramprasad4121/ZeroDOM.git
cd ZeroDOM
npm install
npm test
```

All **110 tests** across **24 test files** should pass. This validates:
- Deterministic constraint enforcement (amount, merchant, expiry, single-use)
- Multi-tenant isolation (cross-account boundary checks)
- Audit trail integrity (PAN/CVC redaction, task story reconstruction)
- Adversarial resilience (prompt injection, retry idempotency, credential safety)

### Run the Live Demo

```bash
npm run live-demo
```

This launches a Playwright browser and runs two scenarios:
1. **Good Agent** — Mints a $25 card, checks out at the correct merchant → **APPROVED**
2. **Hallucinating Agent** — Mints a $5 card, tries to spend $500 → **DECLINED** (security net active)

### Start the Server

```bash
npm run server
```

Starts the Express server on port `4020` with checkout endpoints and card minting API.

---

## Architecture

```mermaid
graph TD
    Agent["AI Agent / Caller"] -->|REST or MCP| IL["Integration Layer"]

    subgraph ZeroDOM Core
        IL --> AS["Account & Funding Layer"]
        IL --> SD["Scope Definer"]
        SD --> IC["Card Issuer Client"]
        IC --> SC["Sandbox Issuer"]
        IC --> ST["Stripe Issuing Client"]
        IL --> CV["Constraint Verifier"]
        IL --> AL["Audit Log (JSONL)"]
        IL --> DB["CLI Dashboard"]
    end

    ST -->|"Stripe-Account header"| SA["User's Stripe Account"]
    SC -->|"Luhn-valid test cards"| TC["Test Checkout"]
```

### Component Overview

| Component | Module | Purpose |
|-----------|--------|---------|
| **Models** | `src/core/models.ts` | Domain types: `Account`, `TaskScope`, `CardRecord`, `TransactionAttempt`, `AuditEvent` |
| **Scope Definer** | `src/core/scope.ts` | Factory + validator for `TaskScope` objects (amount cap, merchant lock, TTL, single-use) |
| **Account Store** | `src/core/accounts.ts` | Multi-tenant accounts with scrypt-hashed API keys and two-phase balance reservations |
| **Card Issuer** | `src/core/issuer.ts` | `SandboxCardIssuerClient` — generates Luhn-valid cards, manages lifecycle, logs audit events |
| **Constraint Verifier** | `src/core/constraint-verifier.ts` | Pure rule engine: checks amount, merchant, expiry, reuse. Returns specific decline codes |
| **Audit Log** | `src/core/audit-log.ts` | `InMemoryAuditLog` and `FileAuditLog` — append-only event sourcing with task story reconstruction |
| **Dashboard** | `src/core/dashboard.ts` | Aggregates card status + audit events into CLI-renderable snapshots |
| **Stripe Client** | `src/core/stripe-issuing.ts` | `StripeIssuingSandboxClient` — maps TaskScopes to Stripe Issuing spending controls |
| **Integration** | `src/core/integration.ts` | `ZeroDOMIntegrationService` facade + REST server + MCP JSON-RPC handler |

---

## API Reference

### REST API

All card/account endpoints require `Authorization: Bearer <api_key>` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/accounts` | Create a sandbox account. Returns API key (shown once) |
| `POST` | `/v1/accounts/:id/fund` | Add funds to an account balance |
| `POST` | `/v1/cards` | Mint a scoped virtual card |
| `GET` | `/v1/cards/:id/status` | Get card status, scope, and transaction history |
| `POST` | `/v1/authorizations` | Authorize a transaction against a card |
| `GET` | `/v1/audit-log` | Query audit trail (filters: `task_id`, `card_id`, `outcome`, `caller_id`) |
| `GET` | `/health` | Health check |

### Mint a Card

```bash
curl -X POST http://localhost:4080/v1/cards \
  -H "Authorization: Bearer zd_test_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "task_scope": {
      "task_id": "buy_charger_001",
      "max_amount": 2500,
      "currency": "usd",
      "merchant_lock": { "type": "merchant_name", "value": "BestBuy" },
      "expires_at": "2026-12-31T23:59:59Z",
      "single_use": true
    }
  }'
```

### Authorize a Transaction

```bash
curl -X POST http://localhost:4080/v1/authorizations \
  -H "Authorization: Bearer zd_test_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "card_id": "card_abc123",
    "attempted_amount": 1999,
    "attempted_merchant": "BestBuy"
  }'
```

**Response** (approved):
```json
{ "result": "approved", "reason": "within scope" }
```

**Response** (declined):
```json
{ "result": "declined_amount", "reason": "attempted 5000 exceeds cap 2500" }
```

---

## MCP Integration

ZeroDOM ships a fully compliant **Model Context Protocol (MCP)** server over `stdio`, allowing AI agents to mint and manage cards as native tools.

### Exposed Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `mint_card` | `caller_id`, `task_scope` (maxAmount, merchantLock, ttlSeconds, singleUse) | Mint a scoped virtual card |
| `get_card_status` | `card_id` | Query card status and transaction history |
| `authorize_transaction` | `card_id`, `attempted_amount`, `attempted_merchant` | Authorize a payment against card constraints |
| `list_audit_log` | `task_id?`, `card_id?`, `outcome?`, `caller_id?` | Query the append-only audit trail |

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "zerodom": {
      "command": "node",
      "args": ["<path-to-zerodom>/dist/scripts/mcp-server.js"],
      "env": {
        "ZERODOM_MCP_API_KEY": "zd_test_your_api_key",
        "ZERODOM_MCP_CONNECT_ACCOUNT_ID": "acct_your_connect_id",
        "ZERODOM_MCP_INITIAL_BALANCE": "10000"
      }
    }
  }
}
```

### Cursor / Windsurf

Add under **Settings → Features → MCP**:
- **Name**: `ZeroDOM`
- **Type**: `command`
- **Command**: `node <path-to-zerodom>/dist/scripts/mcp-server.js`

Set the environment variables to match your account.

> **Note**: Build the project first with `npm run build` to generate `dist/`.

---

## Stripe Integration

ZeroDOM integrates with **Stripe Issuing** to mint real virtual Visa/Mastercard cards with bank-level spending controls.

### Setup

1. Enable [Stripe Issuing](https://stripe.com/issuing) on your Stripe account (test mode)
2. Create a cardholder in the Stripe Dashboard → Issuing → Cardholders
3. Configure `.env`:

```bash
cp .env.example .env
```

```ini
STRIPE_SECRET_KEY=sk_test_...
STRIPE_ISSUING_CARDHOLDER_ID=ich_...
# Optional: for Connect mode
STRIPE_CONNECT_ACCOUNT_ID=acct_...
```

### E2E Purchase Test (Real Stripe Test Money)

```bash
npm run stripe-e2e-purchase
```

This script:
1. Checks/funds the Stripe Issuing balance via Top-ups API
2. Mints a $40-cap card and a $15-cap card
3. Authorizes $35.99 on the $40 card → **APPROVED**
4. Authorizes $20.00 on the $15 card → **DECLINED** (spending controls enforced)
5. Deactivates both cards and prints the final balance

### Stripe Smoke Test

```bash
npm run stripe-sandbox-smoke
```

Verifies API connectivity, card minting, authorization simulation, and cleanup.

### How ZeroDOM Maps to Stripe Issuing

| ZeroDOM Scope | Stripe Issuing Parameter |
|---------------|------------------------|
| `max_amount` | `spending_controls.spending_limits[].amount` |
| `merchant_lock` (category) | `spending_controls.allowed_categories` |
| `single_use: true` | `lifecycle_controls.cancel_after.payment_count = 1` |
| `task_id`, `caller_id` | `metadata.zerodom_task_id`, `metadata.zerodom_caller_id` |

---

## Copy-Paste Prompt

Copy the block below and paste it into **any AI coding assistant** (Claude, Cursor, Windsurf, Gemini, etc.) to have it set up and integrate ZeroDOM into your project:

```text
You are an AI coding assistant. We want to adopt ZeroDOM — an agent-agnostic scoped payment infrastructure — for secure autonomous purchases in this codebase.

Repository: https://github.com/Ramprasad4121/ZeroDOM.git

Follow these steps sequentially:

1. Clone, install, and verify:
   git clone https://github.com/Ramprasad4121/ZeroDOM.git
   cd ZeroDOM && npm install && npm test

   All 110 tests across 24 test files must pass. This validates constraint enforcement,
   multi-tenant isolation, audit trail integrity, and adversarial resilience.

2. Run the live Playwright checkout demo:
   npm run live-demo

   This launches a browser showing two scenarios:
   - Good Agent: $25 card, correct merchant → APPROVED
   - Hallucinating Agent: $5 card, attempts $500 → DECLINED (security net)

3. Start the ZeroDOM server:
   npm run server

4. Read these files to understand the integration pattern:
   - examples/live-demo.ts        → Playwright checkout flow
   - src/core/integration.ts      → REST API + MCP server
   - src/core/issuer.ts           → Card minting and authorization
   - src/core/constraint-verifier.ts → How spending rules are enforced

5. Integrate into our codebase:
   - For REST: POST to http://localhost:4080/v1/cards to mint scoped cards,
     POST to /v1/authorizations to verify transactions
   - For MCP: Add ZeroDOM as an MCP server tool (see README MCP section)
   - For Stripe: Set STRIPE_SECRET_KEY and STRIPE_ISSUING_CARDHOLDER_ID in .env,
     then run npm run stripe-e2e-purchase to verify real card issuance

Report back once all steps compile and run successfully.
```

---

## All npm Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run the full Vitest test suite (110 tests, 24 files) |
| `npm run typecheck` | TypeScript type checking |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run server` | Start Express server (port 4020) |
| `npm run live-demo` | Playwright E2E demo (Good Agent + Hallucinating Agent) |
| `npm run card-demo` | In-memory card sandbox demo with CLI dashboard |
| `npm run audit-demo` | Durable JSONL audit log demo |
| `npm run integration-demo` | REST + MCP integration demo |
| `npm run integration-server` | REST API server (port 4080) |
| `npm run mcp-server` | MCP stdio server |
| `npm run stripe-sandbox-smoke` | Stripe API connectivity smoke test |
| `npm run stripe-e2e-purchase` | Full Stripe E2E purchase with real test money |
| `npm run readiness-check` | Validates all 6 build spec exit criteria |
| `npm run cli-dashboard` | Real-time terminal audit dashboard |
| `npm run checkout-harness` | Playwright checkout form harness |
| `npm run agent-demo` | Autonomous agent purchase demo |

---

## Environment Variables

Copy `.env.example` to `.env` and configure:

```ini
# Stripe Issuing (test mode only — live keys are rejected)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_CONNECT_ACCOUNT_ID=acct_...          # Optional: for Connect mode
STRIPE_ISSUING_CARDHOLDER_ID=ich_...
ZERODOM_STRIPE_MERCHANT_CATEGORY=computer_software_stores

# MCP stdio server
ZERODOM_MCP_API_KEY=zd_test_...
ZERODOM_MCP_CONNECT_ACCOUNT_ID=acct_...
ZERODOM_MCP_INITIAL_BALANCE=5000            # In minor currency units (cents)

# Integration REST server
ZERODOM_INTEGRATION_PORT=4080
```

---

## Project Structure

```
ZeroDOM/
├── src/
│   ├── core/
│   │   ├── models.ts              # Domain types and interfaces
│   │   ├── scope.ts               # TaskScope factory and validator
│   │   ├── accounts.ts            # Multi-tenant account store with scrypt auth
│   │   ├── issuer.ts              # Card issuer (sandbox + Stripe fallback)
│   │   ├── constraint-verifier.ts # Pure rule engine for transaction checks
│   │   ├── audit-log.ts           # Append-only event sourcing (memory + file)
│   │   ├── dashboard.ts           # CLI dashboard projection
│   │   ├── integration.ts         # Service facade + REST server + MCP handler
│   │   ├── stripe-issuing.ts      # Stripe Issuing API adapter
│   │   └── index.ts               # Barrel exports
│   └── server/
│       └── mcp.ts                 # Express checkout + card minting server
├── scripts/
│   ├── stripe-e2e-purchase.ts     # Real Stripe test money E2E
│   ├── stripe-sandbox-smoke.ts    # Stripe API smoke test
│   ├── readiness-check.ts         # Build spec exit criteria validator
│   ├── cli-dashboard.ts           # Real-time terminal dashboard
│   ├── integration-server.ts      # REST API server launcher
│   ├── mcp-server.ts              # MCP stdio server launcher
│   └── ...                        # Additional demo scripts
├── examples/
│   └── live-demo.ts               # Playwright E2E demo (approved + declined)
├── tests/
│   ├── core/                      # 11 test files (scope, issuer, verifier, audit, etc.)
│   └── integration/               # MCP integration tests
├── bin/
│   └── zerodome.js                # CLI launcher
├── docs/                          # Architecture docs, build spec, agent guide
├── public/                        # Flight Recorder demo UI
├── .env.example                   # Environment template
├── package.json
├── tsconfig.json
└── LICENSE                        # MIT
```

---

## Test Suite

The test suite validates every security-critical property:

| Test File | What It Validates |
|-----------|-------------------|
| `scope.test.ts` | TaskScope creation, validation, defaults, edge cases |
| `verifier.test.ts` | Amount caps, merchant matching, expiry, fuzzy match |
| `issuer.integration.test.ts` | Card minting, authorization, single-use, over-cap decline |
| `audit-log.test.ts` | File persistence, sequence continuity, task story reconstruction |
| `dashboard.test.ts` | CLI projection, budget tracking, card expiry during render |
| `integration-layer.test.ts` | REST endpoints, balance funding, cross-account rejection |
| `stripe-issuing.test.ts` | URL encoding, live key rejection, idempotency, Stripe headers |
| `adversarial.test.ts` | Prompt injection, retry idempotency, credential redaction, suspended accounts |
| `e2e-deterministic.test.ts` | Full approved flow, over-scope decline, multi-tenant isolation |
| `repeated-decline.test.ts` | 5x repeated decline determinism (zero flakiness) |
| `playwright-executor.test.ts` | Form filling, hostile checkout handling, re-checkout blocking |
| `mcp.test.ts` | MCP card minting endpoint, input validation |

```bash
npm test
# 24 passed (24 files) · 110 passed (110 tests)
```

---

## Security Model

1. **Fail-Closed**: Missing scope fields → card minting rejected before any money moves
2. **Issuer-Level Enforcement**: Spending controls live at Stripe (bank layer), not in application code
3. **Defense-in-Depth**: Application-level `ConstraintVerifier` runs in parallel for immediate decline reasons
4. **Live Key Rejection**: `assertStripeSandboxKey()` throws on any `sk_live_` key — cannot accidentally use production credentials
5. **API Key Hashing**: `scrypt` with 16-byte salt and `timingSafeEqual` comparison — no timing attacks
6. **PAN/CVC Redaction**: Audit logs store `last4` only. Full card numbers never persisted
7. **Tenant Isolation**: Every query is scoped by `account_id`. Cross-account access throws `AccountAccessError`
8. **Single-Use Cards**: Auto-revoked after first authorized transaction. Cannot be reused

---

## Production Readiness

When moving from sandbox to production:

- [ ] **Stripe Connect OAuth**: Replace sandbox account provisioning with Stripe Connect onboarding redirect webhooks
- [ ] **Database Persistence**: Replace in-memory stores (`SandboxAccountStore`, `SandboxCardIssuerClient`) with PostgreSQL + Redis
- [ ] **Merchant-Name Locks**: Request Stripe's private preview for merchant-ID spending controls (public API only supports category controls)
- [ ] **Background Expiry Sweep**: Run `expireDueCards()` in a production cron queue instead of in-memory `setInterval`
- [ ] **Webhook Handling**: Listen for `issuing_authorization.request` webhooks for real-time authorization decisions

---

## License

[MIT](LICENSE) © 2026 Ramprasad
