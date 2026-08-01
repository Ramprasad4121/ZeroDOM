# Integration Layer

ZeroDOM core is browser-free infrastructure. Any agent framework can call the
same authenticated REST or MCP surface; browsing and checkout remain entirely
in the caller's example client.

## Account Boundary

Every protected call is bound to exactly one account by its API key. The client
cannot select an arbitrary `account_id`: a supplied `TaskScope.account_id` must
match the authenticated account, and card status, balance funding, and audit
queries are always scoped to that account in the data layer.

The included service is an in-memory **sandbox** account store. `POST /fund`
exists only to make local deterministic tests possible. A production deployment
must replace it with durable account storage and a Stripe Connect balance check;
it must never accept a client-provided balance credit.

`npm run integration-server` also runs a local expiry sweep once per second.
Each sweep calls the account-scoped expiry operation and returns an unspent
reservation to that account. Production should run this behavior in a durable
worker with the same per-account boundary.

## REST API

Start the local server:

```bash
npm run integration-server
# http://127.0.0.1:4080
```

Unauthenticated endpoints:

- `GET /health`
- `POST /v1/accounts`

Protected endpoints use `Authorization: Bearer zd_test_...` (or the local-only
`x-zerodom-api-key` header):

- `POST /v1/accounts/:account_id/fund` — local sandbox funding only
- `POST /v1/cards`
- `GET /v1/cards/:card_id/status`
- `POST /v1/authorizations` — local sandbox authorization simulation only
- `GET /v1/audit-log?task_id=&card_id=&outcome=&caller_id=`

Create a local sandbox account. The API key is returned once; the server stores
only its salted hash.

```json
POST /v1/accounts
{
  "stripe_connect_id": "acct_local_sandbox",
  "currency": "usd"
}
```

Fund it locally, then mint a card:

```json
POST /v1/cards
Authorization: Bearer zd_test_...
{
  "caller_id": "claude-agent",
  "task_scope": {
    "task_id": "task_checkout_001",
    "caller_id": "claude-agent",
    "max_amount": 5000,
    "currency": "usd",
    "merchant_lock": {
      "type": "merchant_category",
      "value": "computer_software_stores"
    },
    "expires_at": "2026-08-01T00:05:00.000Z",
    "single_use": true
  }
}
```

`account_id` is optional in the task scope. When supplied, it must equal the
account represented by the API key. The local sandbox returns a non-chargeable
test PAN/CVC for the separate example client; audit responses never include
either value.

## MCP Server

The stdio process receives the account credential through its own environment,
not through agent-visible tool arguments. Set local sandbox values before
starting it:

```bash
ZERODOM_MCP_API_KEY=zd_test_local_mcp \
ZERODOM_MCP_CONNECT_ACCOUNT_ID=acct_local_mcp \
ZERODOM_MCP_INITIAL_BALANCE=5000 \
npm run mcp-server
```

Exposed tools:

- `mint_card(task_scope, caller_id)`
- `get_card_status(card_id)`
- `list_audit_log(filters)`

The MCP server contains no browsing, navigation, checkout, or Playwright logic.

## Deterministic Demo

```bash
npm run integration-demo
```

The demo provisions and funds an isolated sandbox account, mints a scoped card,
approves one in-scope transaction, settles the reserved balance, reads the
account-scoped audit trail, and lists the MCP tools.
