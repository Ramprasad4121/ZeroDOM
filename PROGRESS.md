# ZeroDOM Progress

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
