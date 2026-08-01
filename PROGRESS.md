# ZeroDOM Progress

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
