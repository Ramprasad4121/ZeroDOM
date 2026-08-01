# Stripe Issuing Sandbox

`StripeIssuingSandboxClient` is ZeroDOM's test-mode issuer boundary. It sends
each Issuing request on behalf of the account that owns the task using Stripe's
per-request `Stripe-Account: acct_...` header.

## Safety Constraints

- `STRIPE_SECRET_KEY` must start with `sk_test_`; live keys are rejected before
  any request.
- `STRIPE_CONNECT_ACCOUNT_ID` must be the connected account for the task.
- Merchant-category and per-authorization amount controls are mapped to Stripe
  Issuing spending controls; public Stripe controls do not generally enforce a
  merchant-name lock, so those scopes fail closed at this boundary.
- Stripe test mode does not return PAN/CVC for virtual Issuing cards. The adapter
  therefore never attempts to retrieve them. Only the local in-memory sandbox
  returns disposable test details for the optional example client.
- The smoke script logs issuer references only and deactivates cards in a
  `finally` block where possible.

## Required Environment

```bash
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_CONNECT_ACCOUNT_ID=acct_replace_me
STRIPE_ISSUING_CARDHOLDER_ID=ich_test_replace_me
ZERODOM_STRIPE_MERCHANT_CATEGORY=computer_software_stores
```

## Smoke Command

```bash
npm run stripe-sandbox-smoke
# or
node bin/zerodome.js stripe-smoke
```

The smoke flow creates two connected-account virtual cards, uses Stripe Issuing
test helpers for an in-scope and over-cap authorization, then deactivates both
cards. It proves issuer controls and account routing; it is not a browser
checkout test because Stripe deliberately withholds virtual-card details in
test mode.

## Verified Stripe Primitives

- Create virtual card: `POST /v1/issuing/cards`
- Simulate test authorization: `POST /v1/test_helpers/issuing/authorizations`
- Deactivate card: `POST /v1/issuing/cards/:id` with `status=inactive`
- Account routing: `Stripe-Account: acct_...`
- Spending controls: `spending_controls[allowed_categories]` and
  `spending_controls[spending_limits]`
- Single-use lifecycle control: `lifecycle_controls[cancel_after][payment_count]=1`

Official references:

- https://docs.stripe.com/connect/authentication
- https://docs.stripe.com/issuing/cards/virtual
- https://docs.stripe.com/issuing/controls/spending-controls
- https://docs.stripe.com/api/issuing/cards/create
