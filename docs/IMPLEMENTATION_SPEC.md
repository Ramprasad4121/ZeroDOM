# ZeroDOM Implementation Spec

## Goal

Build a deterministic local demo where a browser-visible agent pays for premium
shopping intelligence using x402 v2-compatible HTTP headers.

## Resource

Paid endpoint: `GET /api/shopping-intel`

Unlocked payload:

- Product: `iPhone 16 128GB`
- Best price: `₹68,999`
- Seller: `Verified Marketplace A`
- Seller trust score: `0.96`
- Delivery ETA: `1 day`
- Price history: `Lowest in 30 days`
- Confidence: `0.94`
- Recommendation: `BUY_NOW`

## x402 Flow

1. Client requests `GET /api/shopping-intel`.
2. Server returns `402 Payment Required`.
3. Server includes `PAYMENT-REQUIRED`, a base64 JSON object with:
   - `x402Version: 2`
   - `resource`
   - `accepts[0].scheme: "exact"`
   - `accepts[0].network: "eip155:84532"`
   - Base Sepolia USDC asset address
   - recipient `payTo`
   - amount in USDC base units
   - short validity window
   - one-time nonce
4. Agent signs an EIP-3009-style EIP-712 `TransferWithAuthorization` payload
   using a disposable local wallet.
5. Agent replays the same request with `PAYMENT-SIGNATURE`.
6. Server verifies the signature, amount, recipient, chain, expiry, and nonce.
7. Server marks the nonce spent and returns `200 OK` plus `PAYMENT-RESPONSE`.

## Safety Constraints

- No real funds.
- No personal keys.
- No live merchant checkout.
- Mock settlement only.
- Nonce replay and expired signatures must return `402`.

## Verification

Required local checks:

```bash
npm run self-test
npm run demo:headless
webcmd zerodome demo:headless
```

Visual demo:

```bash
npm run demo
# or
webcmd zerodome demo
```
