# ZeroDOM Demo Runbook

## One-Minute Pitch

AI agents get stuck at paid resources because checkout is built for humans:
CAPTCHA, SMS OTP, shifting buttons, and fragile DOM automation. ZeroDOM moves the
payment out of the page and into HTTP. The agent reads a `402` invoice, signs a
payment authorization locally, retries with a header, and receives the premium
shopping data it needs.

## Stage Steps

1. Run:

   ```bash
   webcmd zerodome demo
   ```

2. Browser opens the ZeroDOM UI.
3. Click "Start autonomous purchase analysis" if it has not already clicked.
4. The public scan says `NEEDS_PREMIUM_SHOPPING_INTEL`.
5. Keep the terminal and browser side by side. The terminal proves the agent
   never looked for a payment button:

   ```text
   [Intercept] HTTP 402 caught
   [Signer] EIP-3009 authorization signed
   [Execute] Replaying request with PAYMENT-SIGNATURE
   [Unlock] 200 OK, premium resource unlocked
   ```

6. In the browser, point to the Flight Recorder:
   - `GET -> 402 -> Invoice -> Sign -> Replay -> 200`
   - decoded `PAYMENT-REQUIRED` terms: amount, network, recipient, nonce, expiry
   - decoded `PAYMENT-RESPONSE` mock-verification receipt
   - elapsed `402 to 200` time and `DOM payment actions 0`
7. Premium shopping intelligence unlocks:
   - recommendation `BUY_NOW`
   - best price `₹68,999`
   - seller trust `96%`
   - delivery ETA `1 day`

The `demo` command reuses a healthy existing ZeroDOM server on port `4020`, so
it is safe to run after `npm run start`. If port `4020` belongs to anything
else, use `ZERODOME_PORT=4022 webcmd zerodome demo`.

## Fallback

If the visible browser is unreliable on the projector:

```bash
webcmd zerodome demo:headless
npm run self-test
```

Both commands prove the full payment path without needing manual browser control.

## Talking Points

- The UI never handles payment.
- The private key never leaves the local signer.
- The server does not need accounts, sessions, cookies, or API keys.
- The nonce prevents replay.
- The expiry prevents stale invoice reuse.
- Invalid or malformed payment payloads receive a controlled fresh `402` invoice
  instead of a generic server failure.
- Mock settlement keeps the demo instant; production can settle through a
  facilitator or direct onchain submission.
