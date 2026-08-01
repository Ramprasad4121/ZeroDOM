# ZeroDOM

ZeroDOM is a hackathon demo for an autonomous, financially sovereign web agent.
It is evolving into an open-source safety layer for autonomous payments.

There are now two tracks in the repo:

- `x402` demo path: removes payment from browser UI and moves it into an HTTP
  402/signature exchange.
- scoped-card core: mints single-task sandbox virtual cards with amount,
  merchant, expiry, and single-use constraints enforced outside the agent.

The original browser demo removes payment from browser UI and moves it into the
HTTP exchange:

1. A browser agent requests premium shopping intelligence.
2. The server rejects the request with `402 Payment Required`.
3. The response includes an x402 v2 `PAYMENT-REQUIRED` header.
4. The agent signs an EIP-3009-style EIP-712 authorization with a disposable
   local wallet.
5. The agent replays the same request with `PAYMENT-SIGNATURE`.
6. The server verifies the signature and nonce locally, then returns the paid
   shopping-intelligence report with a `PAYMENT-RESPONSE` receipt header.

The premium payload is synthetic market intelligence for an agentic purchase:
best price, seller trust, delivery ETA, price history, confidence, and a
recommended action. It uses no real funds, no personal wallet, and no live
merchant checkout.

## Run

```bash
npm install
npm test
npm run typecheck
npm run card-demo
npm run checkout-harness
npm run test-server
npm run self-test
npm run demo
```

The server is local-only by default:

```bash
npm run start
# http://127.0.0.1:4020
```

`npm run demo` safely reuses a healthy ZeroDOM server already running on its
chosen port. If that port belongs to another process, it fails with a clear
`ZERODOME_PORT=4022` recovery command instead of silently targeting it.

Use an isolated port without disturbing a live stage server:

```bash
ZERODOME_PORT=4022 npm run demo:headless
ZERODOME_PORT=4022 npm run test-server
ZERODOME_PORT=4022 npm run self-test
```

For a non-visual check:

```bash
npm run demo:headless
```

## webcmd Stage Path

The project exposes a local CLI named `zerodome`, which can be registered with
webcmd as an external command:

```bash
npm link
webcmd external register zerodome \
  --binary zerodome \
  --install "cd /Users/ramprasadgoud/Documents/ZeroDOM && npm install && npm link" \
  --desc "ZeroDOM x402 browser payment demo: unlock premium shopping intelligence"
```

Verified commands:

```bash
webcmd zerodome demo:headless
webcmd zerodome demo
```

`webcmd zerodome demo` opens the visible browser flow. The underlying strategy is
Playwright route interception: the browser's paid request is held after the
server returns `402`; Node extracts `PAYMENT-REQUIRED`, signs locally, replays
with `PAYMENT-SIGNATURE`, then fulfills the original browser fetch with the
paid `200` payload. The browser only renders Flight Recorder events through
`window.ZeroDOMDemo.pushEvent()` and never receives a private key.

## Scoped Virtual-Card Core

The updated open-source plan lives in [docs/AGENTS.md](docs/AGENTS.md)
and [docs/ZeroDOM — Build Specification](docs/ZeroDOM%20%E2%80%94%20Build%20Specification).
The new TypeScript core is under [src/core/index.ts](src/core/index.ts).

Run the deterministic sandbox flow:

```bash
npm run card-demo
```

It mints two sandbox virtual cards:

- one in-scope authorization that is approved and then locked after single use
- one over-cap authorization that is declined and written to the audit trail
- a dashboard-style CLI view of active cards, remaining budget, and audit trail

The core currently includes:

- `TaskScope` validation that fails closed without amount cap, expiry, or
  merchant lock
- sandbox issuer client with unique card records and no card reuse per task
- constraint verifier for amount, merchant, expiry, and reuse decisions
- audit log queryable by task, card, and transaction outcome
- dashboard projection and CLI formatter that redact full card number and CVC
- Stripe Issuing sandbox parameter guard that rejects live keys and maps
  category locks to spending controls plus single-use lifecycle controls
- Stripe Issuing sandbox HTTP adapter with mocked tests for card creation,
  expanded card-detail retrieval, test-helper authorizations, and deactivation
- scripted executor used to test hostile checkout behavior
- Playwright checkout executor and deterministic in-memory checkout harness

The real checkout target site is intentionally not hardcoded. Per
`docs/AGENTS.md`, the target site must be chosen explicitly because browser
automation and bot-detection risk depend on that choice.

Deterministic Playwright checkout harness:

```bash
npm run checkout-harness
```

See [docs/PLAYWRIGHT_CHECKOUT.md](docs/PLAYWRIGHT_CHECKOUT.md).

Optional real Stripe sandbox smoke:

```bash
STRIPE_SECRET_KEY=sk_test_... \
STRIPE_ISSUING_CARDHOLDER_ID=ich_... \
npm run stripe-sandbox-smoke
```

See [docs/STRIPE_SANDBOX.md](docs/STRIPE_SANDBOX.md). This command refuses
live-mode keys and prints only card IDs/last4.

## Demo Narrative

An autonomous shopping agent compares offers for an iPhone 16. The public scan
is inconclusive, so it needs paid market intelligence before choosing whether to
buy now, wait, or switch sellers. Instead of clicking through Stripe, CAPTCHA,
OTP, or a checkout page, it reads the `402` invoice from headers, signs locally,
and unlocks the JSON data it needs to decide.

The stage line:

> Standard agents die at the checkout UI. ZeroDOM moves the agent to the
> network layer, negotiates HTTP 402 with an invisible EVM signature, and
> mock-verifies the payment deterministically in milliseconds.

## Protocol Notes

This demo targets x402 v2:

- Server to client: `PAYMENT-REQUIRED`
- Client to server: `PAYMENT-SIGNATURE`
- Server to client receipt: `PAYMENT-RESPONSE`
- Scheme: `exact`
- Network: `eip155:84532` for Base Sepolia
- Settlement: mock local verification for live-demo reliability

`X-PAYMENT` is accepted by the mock server as a legacy compatibility alias, but
the demo path uses the v2 `PAYMENT-SIGNATURE` header. Coinbase's v1 to v2
migration guide identifies `X-PAYMENT` as the v1 header and
`PAYMENT-SIGNATURE` as the v2 header.

Malformed or invalid submitted `PAYMENT-SIGNATURE` headers return
`400 Bad Request` with a `BAD_PAYMENT_SIGNATURE` JSON body. Missing payment
material remains a `402 Payment Required` challenge.

Reference docs checked during implementation:

- https://docs.x402.org/core-concepts/http-402
- https://docs.x402.org/core-concepts/client-server
- https://docs.cdp.coinbase.com/x402/migration-guide
- https://github.com/x402-foundation/x402

## Safety

The demo uses public Hardhat private keys. They are disposable test keys and must
never hold real funds. Production ZeroDOM should use a managed wallet, spend
limits, audit logs, and facilitator or direct onchain settlement.

For the scoped-card core, Stripe or issuer credentials must be sandbox/test mode
only. `.env` is gitignored, and `.env.example` contains placeholders only.
Live Stripe secret keys are rejected by the Stripe parameter guard.

The local signer has an explicit policy: it only signs the expected `exact`
Base Sepolia USDC invoice for the local mock recipient, price, nonce, and valid
authorization window. It rejects unexpected terms before an authorization is
created.

The named phase artifacts are:

- `src/server.js`: local Express paywall and verifier
- `src/signer.js`: disposable local EVM wallet boundary
- `public/index.html` and `public/app.js`: Flight Recorder UI and
  `window.ZeroDOMDemo.pushEvent()`
- `scripts/run-demo.js`: Playwright route interceptor
- `scripts/test-server.js`: server security preflight for 402, 400, and 200
  outcomes

The demo does not place a real order. It only unlocks synthetic shopping
intelligence after local signature verification.
