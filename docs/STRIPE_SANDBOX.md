# Stripe Issuing Sandbox

ZeroDOM's real issuer boundary is `StripeIssuingSandboxClient` in `src/core/stripe-issuing.ts`.
It is intentionally test-mode only:

- `STRIPE_SECRET_KEY` must start with `sk_test_`.
- `sk_live_` keys are rejected before any network request is made.
- Card details are retrieved only for sandbox virtual cards and the smoke script prints last4 only.
- The smoke script deactivates minted sandbox cards in a `finally` block where possible.

## Required Environment

```bash
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_ISSUING_CARDHOLDER_ID=ich_test_replace_me
ZERODOM_STRIPE_MERCHANT_CATEGORY=computer_software_stores
```

`ZERODOM_STRIPE_MERCHANT_CATEGORY` must be a Stripe Issuing merchant category. The default is a category-style scope because merchant-name controls are not generally issuer-enforceable through Stripe's public card spending controls.

## Smoke Command

```bash
npm run stripe-sandbox-smoke
# or
node bin/zerodome.js stripe-smoke
```

The smoke flow:

1. Creates one in-scope sandbox virtual card.
2. Creates one over-cap sandbox virtual card.
3. Retrieves expanded sandbox card details to prove checkout credentials can be handed to an agent, but prints only `last4`.
4. Uses Stripe Issuing test helpers to simulate one in-scope authorization and one over-cap authorization.
5. Attempts to deactivate both minted sandbox cards.

## Verified Stripe Primitives

- Create virtual card: `POST /v1/issuing/cards`
- Retrieve card with `expand[]=number` and `expand[]=cvc`: `GET /v1/issuing/cards/:id`
- Simulate test authorization: `POST /v1/test_helpers/issuing/authorizations`
- Deactivate card: `POST /v1/issuing/cards/:id` with `status=inactive`
- Spending controls: `spending_controls[allowed_categories]` and `spending_controls[spending_limits]`
- Single-use lifecycle controls: `lifecycle_controls[cancel_after][payment_count]=1`

Official references:

- https://docs.stripe.com/api/issuing/cards/create
- https://docs.stripe.com/api/issuing/cards/retrieve
- https://docs.stripe.com/api/issuing/authorizations/test_mode_create
- https://docs.stripe.com/issuing/controls/spending-controls
- https://docs.stripe.com/issuing/controls/lifecycle-controls
