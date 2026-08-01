# Optional Playwright Example Client

`PlaywrightCheckoutExecutor` is an optional reference client under
`scripts/example-client/`. It is deliberately outside `src/core/` because
ZeroDOM core is not a browsing agent. Any real agent should call the REST or MCP
integration layer, then perform checkout using its own tools.

The example accepts:

- a Playwright `Page`-compatible object
- an `IssuedCard`
- site-specific selectors for card number, CVC, expiry, amount, merchant, merchant category, and submit

The executor fills the checkout form, reads merchant/amount metadata from the
page, clicks submit, then asks the issuer to authorize the transaction. It
returns redacted telemetry with `last4` only.

## Deterministic Harness

```bash
npm run checkout-harness
# or
node bin/zerodome.js checkout-harness
```

The harness uses an in-memory checkout page. It does not choose a real target
site and does not make a purchase. It verifies that a separable example client
can fill form fields and pipe the resulting checkout metadata through the
scoped-card issuer.

## Real Site Adapter

The next real-site step is to add a tiny adapter for the chosen checkout target:

```ts
{
  cardNumber: "...",
  cvc: "...",
  expMonth: "...",
  expYear: "...",
  submit: "...",
  amount: "...",
  merchant: "...",
  merchantCategory: "..."
}
```

Per `docs/AGENTS.md`, do not silently pick this target site. Bot-detection and checkout ergonomics depend heavily on the merchant, so the site choice remains a human decision.

## Safety

- Example-client telemetry must never include full card number or CVC.
- The issuer, not page content, decides whether an attempt is approved.
- Prompt-injected page text cannot bypass amount, merchant, expiry, or reuse constraints.
