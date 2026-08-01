# AGENTS.md — ZeroDOM

## What you're building
Read `zerodom-build-spec.md` in full before writing any code. It is the source of truth for the problem, architecture, data models, functional/security requirements, and test plan. This file only tells you how to work, not what to build.

## Operating loop
Work in this cycle, repeatedly, without stopping to ask for permission between cycles:

1. Pick the next unbuilt piece, in this order: data models → Account & Funding Layer (Stripe Connect onboarding) → Scope Definer → Card Issuer Client (sandbox mode) → Constraint Verifier → Integration Layer (MCP server + REST API) → Audit Log → Dashboard/CLI → example client (last, optional, separate from core).
2. Implement it.
3. Write and run its tests from the spec's test plan (unit first, then integration, then adversarial once the piece it depends on is stable).
4. If any test fails, fix the code, not the test — the spec's test plan is intentionally strict. Do not weaken an adversarial test to make it pass.
5. Re-run the full test suite, not just the fixed case, before moving to the next piece.
6. Log what you built and what you verified in `PROGRESS.md` (create it if missing) — one dated entry per cycle, a few lines: what changed, what passed, what's still open.

Do not declare the project done until every condition in the spec's "Definition of 100% ready" section is independently verified true in the same session — re-check all six, not just the ones you touched most recently.

## Defaults — use these unless told otherwise
- Language/stack: TypeScript + Node.js for all services; Playwright for browser automation.
- Card issuer: Stripe Issuing + Stripe Connect, **test/sandbox mode only**. Never call a live-mode endpoint. Each user's funded balance is their own Stripe Connect account, not a shared ZeroDOM-operator balance.
- Target site for the checkout test: ask before picking one if none is specified — site choice affects how much Playwright fights bot-detection, and that's a judgment call worth a human's input rather than a silent default.
- Testing framework: Vitest or Jest, whichever is already in the repo; Vitest if starting fresh.

## Hard rules — do not violate these even under time pressure
- Never use a real, unscoped payment credential anywhere — not in code, not in a test fixture, not in a log line, not in a commit.
- Never commit API keys or secrets. Use environment variables and confirm `.env` is gitignored before the first commit.
- Never mint a card from a `TaskScope` that's missing an amount cap, an expiry, or a merchant lock — this must fail closed in code, not just in a test.
- Never mark a test as skipped or expected-to-fail to get past a blocker — surface the blocker in `PROGRESS.md` instead and keep working on something else.
- Never let one account's credential touch another account's cards, balance, or audit log — every single query and mutation must be scoped by `account_id` at the data layer, no exceptions, even for admin/debug tooling.

## Agent-agnosticism rule
ZeroDOM is infrastructure any agent framework can call — Claude, Codex, Hermes, OpenClaw, or anything else — never a browsing agent itself. No browsing, page-navigation, or checkout-automation logic belongs in the core (Scope Definer, Card Issuer Client, Constraint Verifier, Audit Log, Integration Layer). If you find yourself writing Playwright code anywhere other than the optional example client, stop — that logic belongs to whichever agent is calling ZeroDOM, not to ZeroDOM. The Integration Layer must work for a caller that never touches a browser at all (e.g. an agent buying an API credit directly).

## UI design rule
The dashboard/CLI UI must be **black, white, and gray only** — no other colors anywhere, including accent colors, status colors, or brand colors. Use borders, weight, spacing, and icons to communicate structure and state (approved/declined/expired), not color. If a UI library's defaults include colored buttons, links, or badges, override them to grayscale rather than leaving the default. This applies to every screen, not just the main dashboard view.

## When you're stuck
If a task requires something you can't do (creating a real Stripe account, choosing between two reasonable architectures with no clear spec guidance, a site that blocks Playwright entirely), stop and write the specific blocker to `PROGRESS.md` with what you tried, rather than guessing silently and continuing.

## Definition of done
See `zerodom-build-spec.md`, "Definition of 100% ready." All six conditions, verified together, in one session, is the only acceptable exit state.
