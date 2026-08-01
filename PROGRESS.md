# ZeroDOM Progress

## 2026-08-01 13:04 IST

Completed the readiness verification cycle. Added `authorize_transaction` as
an MCP tool so MCP callers can complete the full mint → authorize → audit cycle.
Wrapped `handleZeroDOMRestOperation` in try/catch so it returns proper HTTP
status codes (400/401/403/404/500) for all error paths without requiring the
HTTP request handler wrapper.

Added 16 new tests across 4 files:

- `repeated-decline.test.ts`: 5 independent over-cap, wrong-merchant, and
  single-use reuse decline runs with determinism assertions (Build Spec
  condition 3).
- `e2e-deterministic.test.ts`: Full approved purchase flow, graceful over-scope
  decline, multi-tenant isolation, and task story reconstruction from audit
  trail alone.
- `adversarial.test.ts`: Suspended account card mint rejection, REST-level
  cross-account HTTP status code verification (401/403/404).
- `integration-layer.test.ts`: Health endpoint, malformed body, unknown route,
  duplicate account, MCP `authorize_transaction` tool end-to-end cycle, and
  updated `tools/list` assertion.

Added `npm run readiness-check` (also `zerodome readiness-check`) that verifies
all 6 exit conditions from the Build Specification in one session. Current
result: 17/17 automatable checks pass; condition 2 (live site) correctly
blocked on human site selection.

Updated `.env.example` with all missing environment variables.

Verified:
- `npm run typecheck`
- `npm test` (47 tests, 10 files, all pass)
- `npm run readiness-check` (17 passed, 0 failed, 1 blocked)
- `npm run card-demo`
- `npm run integration-demo`

Still open:
- Condition 2 (live run against real site in sandbox payment mode) remains
  blocked on human site selection per `docs/AGENTS.md`.
- Real Stripe sandbox smoke needs `sk_test_...` and `STRIPE_ISSUING_CARDHOLDER_ID`.
- Durable production account repository replaces in-memory sandbox layer.

## 2026-08-01 12:42 IST

Completed the Account & Funding Layer and made the REST/MCP boundary
account-authenticated. `SandboxAccountStore` now hashes per-account sandbox API
keys, reserves only the caller's funded balance before a mint, settles an
approved authorization, and releases reservations on expiry. The issuer, audit
log, dashboard, and integration service all require `account_id` at their data
boundary; two accounts can safely use the same task ID.

Updated the Stripe sandbox adapter to send `Stripe-Account` on every request
and corrected an important test-mode limitation: Stripe does not expose
virtual-card PAN/CVC in test mode, so the external adapter never claims to
retrieve it. The local non-chargeable sandbox remains the only source of demo
card details for the optional example client.

Verified:
- `npm run typecheck`
- `npm test` (31 tests, including unfunded-account, cross-account isolation,
  same-task-ID tenant isolation, and expiry/refund coverage)
- `npm run integration-demo`
- `npm run card-demo`
- `npm run audit-demo`
- `npm run mcp-server` fails closed without an MCP account credential
- `node bin/zerodome.js stripe-smoke` fails closed without all Stripe sandbox
  variables
- `ZERODOME_PORT=4052 npm run test-server` (402 challenge, malformed/tampered,
  replay, wrong-amount, and expiry rejection coverage)
- `ZERODOME_PORT=4053 npm run demo:headless` (browser Flight Recorder shows
  DOM payment actions `0` and timer freeze after the 200 unlock)
- `npm run checkout-harness`

Still open:
- A durable production account repository, Stripe Connect onboarding callback,
  and server-side balance verification replace the in-memory sandbox layer.
- A real Stripe test account/cardholder and an explicitly chosen sandbox
  checkout target are required for the live readiness tests.
- No live-mode Stripe credentials, real card data, or real purchases have been
  used.

## 2026-08-01 11:50 IST

Built the Playwright checkout executor boundary. Added `PlaywrightCheckoutExecutor`, selector-driven checkout form filling, merchant/amount extraction, issuer authorization, and redacted telemetry that includes `last4` but never full card number or CVC. Added a deterministic in-memory browser harness via `npm run checkout-harness` and `zerodome checkout-harness`.

Added `docs/PLAYWRIGHT_CHECKOUT.md` to document the adapter contract for a future real checkout target.

Verified:
- `npm run typecheck`
- `npm test` (24 tests)
- `npm run checkout-harness` (required browser permissions in this sandbox)
- `node bin/zerodome.js checkout-harness` (required browser permissions in this sandbox)
- `node bin/zerodome.js stripe-smoke` fails closed without sandbox env vars
- `ZERODOME_PORT=4040 npm run test-server`
- `ZERODOME_PORT=4041 npm run demo:headless`

Still open:
- Real checkout target site remains blocked on human selection per `docs/AGENTS.md`.
- Real Stripe sandbox smoke still needs sandbox credentials/cardholder.
- The live 100% readiness checks cannot be claimed until the selected site and Stripe sandbox environment are available.

## 2026-08-01 11:44 IST

Built the Stripe Issuing sandbox adapter boundary. Added a test-mode-only HTTP client that creates scoped virtual cards with spending/lifecycle controls, retrieves expanded sandbox card details, simulates Stripe Issuing test-helper authorizations, and deactivates sandbox cards for cleanup. Added `npm run stripe-sandbox-smoke` and `zerodome stripe-smoke`, both guarded by `STRIPE_SECRET_KEY=sk_test_...` and `STRIPE_ISSUING_CARDHOLDER_ID`.

Added `docs/STRIPE_SANDBOX.md` with the sandbox runbook and official Stripe API references. The smoke script prints only issuer card IDs and `last4`, never full card number or CVC.

Verified:
- `npm run typecheck`
- `npm test` (21 tests)
- `npm run card-demo`
- `node bin/zerodome.js stripe-smoke` fails closed without sandbox env vars
- `ZERODOME_PORT=4038 npm run test-server`
- `ZERODOME_PORT=4039 npm run demo:headless`

Still open:
- Real Stripe sandbox smoke cannot be executed until a sandbox account/cardholder and `sk_test_...` credential are supplied.
- Real checkout target site remains blocked on human selection per `docs/AGENTS.md`.
- The five repeated over-scope live runs from the 100% readiness definition are not claimable until the real sandbox checkout path exists.

## 2026-08-01 11:36 IST

Built the next spec-ordered local piece: Dashboard/CLI. Added a redacted dashboard projection that shows active cards, their `TaskScope`, remaining budget, authorization count, last outcome, and the audit trail without exposing full sandbox card number or CVC.

Updated `npm run card-demo` to print the dashboard view, and added an exact `docs/ZeroDOM-Build Specification` pointer for handoffs that use the hyphenated filename.

Verified so far in this cycle:
- `npm run typecheck`
- `npm test` (16 tests)
- `npm run card-demo`
- `node bin/zerodome.js card-demo`
- `ZERODOME_PORT=4034 npm run test-server`
- `ZERODOME_PORT=4035 npm run demo:headless`

Still open:
- Real checkout target site remains blocked on human selection per `docs/AGENTS.md`.
- Real Stripe Issuing sandbox execution still needs a test account/cardholder and sandbox credentials.
- The five repeated over-scope live runs from the 100% readiness definition are not claimable until the real sandbox checkout path exists.

## 2026-08-01 11:28 IST

Built the first open-source scoped-card core cycle from `docs/ZeroDOM — Build Specification`:
data models, strict `TaskScope` validation, sandbox card issuer, constraint verifier, audit log, Stripe Issuing sandbox parameter guard, and scripted executor tests.

Added `npm test`, `npm run typecheck`, and `npm run card-demo`. The deterministic card demo now shows one approved single-use authorization and one over-cap decline without logging card number or CVC.

Verified:
- `npm run typecheck`
- `npm test`
- `npm run card-demo`
- `node bin/zerodome.js card-demo`
- `ZERODOME_PORT=4030 npm run test-server`
- `ZERODOME_PORT=4031 npm run demo:headless`

Still open:
- Real checkout target site is intentionally blocked on human selection per `docs/AGENTS.md`.
- Real Stripe Issuing sandbox execution needs a test account, `sk_test_...`, and `STRIPE_ISSUING_CARDHOLDER_ID`; no live credentials should ever be used.
- Merchant-name issuer enforcement is not generally available through public Stripe controls; current Stripe parameter mapping fails closed unless the scope uses a merchant category.
