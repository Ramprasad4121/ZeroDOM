import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AccountAccessError, SandboxAccountStore, type AccountCredential, type PublicAccount } from "./accounts.js";
import { InMemoryAuditLog, type AuditLog } from "./audit-log.js";
import { CardIssueError, SandboxCardIssuerClient, type CardIssuerClient } from "./issuer.js";
import type {
  AuditEvent,
  CurrencyCode,
  IssuedCard,
  TaskScope,
  TransactionAttempt,
  TransactionRequest,
  TransactionResult
} from "./models.js";
import { ScopeValidationError, validateTaskScope } from "./scope.js";

export interface ZeroDOMIntegrationServiceOptions {
  issuer?: CardIssuerClient;
  auditLog?: AuditLog;
  accounts?: SandboxAccountStore;
  now?: () => Date;
}

export interface AuthContext {
  api_key?: string;
}

export interface AccountSignupInput {
  account_id?: string;
  stripe_connect_id: string;
  currency: CurrencyCode;
  api_key?: string;
}

export interface SandboxProvisionAccountInput extends AccountSignupInput {
  initial_balance?: number;
}

export interface FundAccountInput {
  account_id: string;
  amount: number;
  currency: CurrencyCode;
}

export interface MintCardInput {
  task_scope: Partial<TaskScope>;
  caller_id?: string;
}

export interface CardStatusInput {
  card_id: string;
}

export type AuthorizationInput = Omit<TransactionRequest, "account_id"> & {
  account_id?: string;
};

export interface AuditLogFilters {
  account_id?: string;
  task_id?: string;
  card_id?: string;
  outcome?: TransactionResult;
  caller_id?: string;
}

export interface CardStatusResponse {
  card: ReturnType<CardIssuerClient["getStatusAndHistory"]>["card"];
  scope: TaskScope;
  attempts: TransactionAttempt[];
}

export interface RestOperationInput {
  method: string;
  path: string;
  query?: Record<string, string | undefined>;
  headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface RestOperationResponse {
  statusCode: number;
  payload: unknown;
}

export class ZeroDOMIntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZeroDOMIntegrationError";
  }
}

export class ZeroDOMIntegrationService {
  readonly issuer: CardIssuerClient;
  readonly auditLog: AuditLog;
  readonly accounts: SandboxAccountStore;
  readonly #now: () => Date;

  constructor(options: ZeroDOMIntegrationServiceOptions = {}) {
    const auditLog = options.auditLog ?? new InMemoryAuditLog();
    this.auditLog = auditLog;
    this.issuer = options.issuer ?? new SandboxCardIssuerClient({ auditLog });
    this.accounts = options.accounts ?? new SandboxAccountStore();
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Local-only provisioning helper. Production signup must complete Stripe Connect
   * onboarding and verify the connected balance before persisting the account.
   */
  provisionSandboxAccount(input: SandboxProvisionAccountInput): AccountCredential {
    return this.accounts.createAccount({
      accountId: input.account_id,
      stripeConnectId: input.stripe_connect_id,
      currency: input.currency,
      initialBalance: input.initial_balance ?? 0,
      apiKey: input.api_key,
      now: this.#now()
    });
  }

  createAccount(input: AccountSignupInput): AccountCredential {
    return this.provisionSandboxAccount(input);
  }

  fundAccount(input: FundAccountInput, auth: AuthContext): PublicAccount {
    const account = this.#authenticate(auth);
    this.#assertOwnAccount(account, input.account_id);
    return this.accounts.fundAccount(account.account_id, input.amount, input.currency);
  }

  mintCard(input: MintCardInput, auth: AuthContext, now = this.#now()): IssuedCard {
    const account = this.#authenticate(auth);
    const scope = normalizeTaskScope(input, account.account_id, now);
    this.accounts.reserveTask(account.account_id, scope.task_id, scope.max_amount, scope.currency);
    try {
      return this.issuer.mintCard(scope, now);
    } catch (error) {
      this.accounts.releaseTask(account.account_id, scope.task_id);
      throw error;
    }
  }

  getCardStatus(input: CardStatusInput, auth: AuthContext, now = this.#now()): CardStatusResponse {
    if (!input.card_id) {
      throw new ZeroDOMIntegrationError("card_id is required");
    }
    const account = this.#authenticate(auth);
    this.expireAccountCards(account.account_id, now);
    const status = this.issuer.getStatusAndHistory(input.card_id, account.account_id);
    return {
      card: status.card,
      scope: this.issuer.getScopeForCard(input.card_id, account.account_id),
      attempts: status.attempts
    };
  }

  authorizeTransaction(request: AuthorizationInput, auth: AuthContext, now = this.#now()) {
    const account = this.#authenticate(auth);
    if (request.account_id && request.account_id !== account.account_id) {
      throw new AccountAccessError("authorization account_id does not match the authenticated account");
    }
    this.expireAccountCards(account.account_id, now);
    const card = this.issuer.getStatusAndHistory(request.card_id, account.account_id).card;
    const attempt = this.issuer.authorize({ ...request, account_id: account.account_id }, now);
    if (attempt.result === "approved") {
      this.accounts.settleTask(account.account_id, card.task_id, attempt.attempted_amount);
    } else if (attempt.result === "declined_expired") {
      this.accounts.releaseTask(account.account_id, card.task_id);
    }
    return attempt;
  }

  listAuditLog(filters: AuditLogFilters = {}, auth: AuthContext): AuditEvent[] {
    const account = this.#authenticate(auth);
    if (filters.account_id) {
      this.#assertOwnAccount(account, filters.account_id);
    }
    if (filters.card_id) {
      this.issuer.getStatusAndHistory(filters.card_id, account.account_id);
    }

    let events = this.auditLog.byAccount(account.account_id);
    if (filters.task_id) {
      events = events.filter((event) => event.task_id === filters.task_id);
    }
    if (filters.card_id) {
      events = events.filter((event) => event.card_id === filters.card_id);
    }
    if (filters.outcome) {
      events = events.filter((event) => event.transaction?.result === filters.outcome);
    }
    if (filters.caller_id) {
      events = events.filter((event) => event.caller_id === filters.caller_id);
    }
    return events;
  }

  expireAccountCards(accountId: string, now = this.#now()) {
    const expired = this.issuer.expireCards(accountId, now);
    for (const card of expired) {
      this.accounts.releaseTask(accountId, card.task_id);
    }
    return expired;
  }

  expireDueCards(now = this.#now()) {
    return this.accounts.accountIds().flatMap((accountId) => this.expireAccountCards(accountId, now));
  }

  #authenticate(auth: AuthContext): PublicAccount {
    return this.accounts.authenticateApiKey(auth.api_key);
  }

  #assertOwnAccount(account: PublicAccount, accountId: string) {
    if (!accountId || accountId !== account.account_id) {
      throw new AccountAccessError("account_id does not match the authenticated account");
    }
  }
}

export function createZeroDOMRestServer({
  service = new ZeroDOMIntegrationService()
}: {
  service?: ZeroDOMIntegrationService;
} = {}): Server {
  return createServer((request, response) => {
    void handleZeroDOMRestRequest({ request, response, service });
  });
}

export async function handleZeroDOMRestRequest({
  request,
  response,
  service
}: {
  request: IncomingMessage;
  response: ServerResponse;
  service: ZeroDOMIntegrationService;
}) {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const operation = await handleZeroDOMRestOperation(service, {
      method: request.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: request.headers,
      body: expectsJsonBody(request.method) ? await readJsonBody(request) : undefined
    });
    return writeJson(response, operation.statusCode, operation.payload);
  } catch (error) {
    return writeJson(response, statusForError(error), {
      error: errorName(error),
      message: errorMessage(error)
    });
  }
}

export async function handleZeroDOMRestOperation(
  service: ZeroDOMIntegrationService,
  { method, path, query = {}, headers, body }: RestOperationInput
): Promise<RestOperationResponse> {
  try {
    return await dispatchRestOperation(service, { method, path, query, headers, body });
  } catch (error) {
    return {
      statusCode: statusForError(error),
      payload: {
        error: errorName(error),
        message: errorMessage(error)
      }
    };
  }
}

async function dispatchRestOperation(
  service: ZeroDOMIntegrationService,
  { method, path, query = {}, headers, body }: RestOperationInput
): Promise<RestOperationResponse> {
  if (method === "GET" && path === "/health") {
    return {
      statusCode: 200,
      payload: { ok: true, service: "zerodom-integration" }
    };
  }
  if (method === "POST" && path === "/v1/accounts") {
    return {
      statusCode: 201,
      payload: service.createAccount(parseCreateAccount(body))
    };
  }

  const fundMatch = /^\/v1\/accounts\/([^/]+)\/fund$/.exec(path);
  if (method === "POST" && fundMatch) {
    return {
      statusCode: 200,
      payload: service.fundAccount(
        {
          account_id: decodeURIComponent(fundMatch[1]),
          ...parseFundAccount(body)
        },
        authFromHeaders(headers)
      )
    };
  }
  if (method === "POST" && path === "/v1/cards") {
    return {
      statusCode: 201,
      payload: service.mintCard(body as MintCardInput, authFromHeaders(headers))
    };
  }
  const statusMatch = /^\/v1\/cards\/([^/]+)\/status$/.exec(path);
  if (method === "GET" && statusMatch) {
    return {
      statusCode: 200,
      payload: service.getCardStatus({ card_id: decodeURIComponent(statusMatch[1]) }, authFromHeaders(headers))
    };
  }
  if (method === "POST" && path === "/v1/authorizations") {
    return {
      statusCode: 201,
      payload: service.authorizeTransaction(body as AuthorizationInput, authFromHeaders(headers))
    };
  }
  if (method === "GET" && path === "/v1/audit-log") {
    return {
      statusCode: 200,
      payload: {
        events: service.listAuditLog(
          {
            account_id: queryValue(query, "account_id"),
            task_id: queryValue(query, "task_id"),
            card_id: queryValue(query, "card_id"),
            outcome: parseOutcome(queryValue(query, "outcome")),
            caller_id: queryValue(query, "caller_id")
          },
          authFromHeaders(headers)
        )
      }
    };
  }

  return {
    statusCode: 404,
    payload: { error: "NOT_FOUND", message: "unknown ZeroDOM integration route" }
  };
}

export const zerodomMcpTools = [
  {
    name: "mint_card",
    description: "Mint a single-task sandbox virtual card for the authenticated account.",
    inputSchema: {
      type: "object",
      properties: {
        caller_id: { type: "string" },
        task_scope: { type: "object" }
      },
      required: ["caller_id", "task_scope"]
    }
  },
  {
    name: "get_card_status",
    description: "Return status, scope, and authorization history for an authenticated account's card.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string" }
      },
      required: ["card_id"]
    }
  },
  {
    name: "authorize_transaction",
    description: "Submit a transaction authorization against a minted card for the authenticated account.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string" },
        attempted_amount: { type: "number" },
        attempted_merchant: { type: "string" },
        attempted_merchant_category: { type: "string" }
      },
      required: ["card_id", "attempted_amount", "attempted_merchant"]
    }
  },
  {
    name: "list_audit_log",
    description: "List audit events for the authenticated account, optionally filtered by task, card, outcome, or caller.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        card_id: { type: "string" },
        outcome: { type: "string" },
        caller_id: { type: "string" }
      }
    }
  }
] as const;

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export async function handleMcpJsonRpc(service: ZeroDOMIntegrationService, message: unknown, auth: AuthContext = {}) {
  if (!isRecord(message) || typeof message.method !== "string") {
    return jsonRpcError(null, -32600, "invalid JSON-RPC request");
  }
  const request = message as unknown as JsonRpcRequest;
  if (request.method === "notifications/initialized" || request.id === undefined) {
    return null;
  }
  if (request.method === "initialize") {
    return jsonRpcResult(request.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "zerodom", version: "0.1.0" }
    });
  }
  if (request.method === "tools/list") {
    return jsonRpcResult(request.id, { tools: zerodomMcpTools });
  }
  if (request.method === "tools/call") {
    return handleMcpToolCall(service, request, auth);
  }
  return jsonRpcError(request.id, -32601, `unknown method ${request.method}`);
}

function handleMcpToolCall(service: ZeroDOMIntegrationService, request: JsonRpcRequest, auth: AuthContext) {
  try {
    const params = mustRecord(request.params, "tools/call params");
    const name = mustString(params.name, "tool name");
    const args = mustRecord(params.arguments ?? {}, "tool arguments");
    let result: unknown;

    if (name === "mint_card") {
      result = service.mintCard(args as unknown as MintCardInput, auth);
    } else if (name === "get_card_status") {
      result = service.getCardStatus(args as unknown as CardStatusInput, auth);
    } else if (name === "authorize_transaction") {
      result = service.authorizeTransaction(args as unknown as AuthorizationInput, auth);
    } else if (name === "list_audit_log") {
      result = { events: service.listAuditLog(args as unknown as AuditLogFilters, auth) };
    } else {
      return jsonRpcError(request.id ?? null, -32602, `unknown ZeroDOM tool ${name}`);
    }

    return jsonRpcResult(request.id ?? null, {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    });
  } catch (error) {
    return jsonRpcResult(request.id ?? null, {
      isError: true,
      content: [{ type: "text", text: errorMessage(error) }]
    });
  }
}

function normalizeTaskScope(input: MintCardInput, accountId: string, now: Date): TaskScope {
  if (!input || !input.task_scope) {
    throw new ZeroDOMIntegrationError("task_scope is required");
  }
  if (input.task_scope.account_id && input.task_scope.account_id !== accountId) {
    throw new AccountAccessError("TaskScope.account_id does not match the authenticated account");
  }
  if (input.caller_id && input.task_scope.caller_id && input.caller_id !== input.task_scope.caller_id) {
    throw new ZeroDOMIntegrationError("caller_id must match TaskScope.caller_id when both are provided");
  }
  const scope = {
    ...input.task_scope,
    account_id: accountId,
    caller_id: input.caller_id ?? input.task_scope.caller_id
  };
  validateTaskScope(scope, now);
  return structuredClone(scope);
}

function parseCreateAccount(body: unknown): AccountSignupInput {
  const input = mustRecord(body, "account creation body");
  if ("initial_balance" in input || "initialBalance" in input) {
    throw new ZeroDOMIntegrationError("initial balance cannot be set during signup; use the sandbox funding endpoint");
  }
  return {
    account_id: optionalString(input.account_id, "account_id"),
    stripe_connect_id: mustString(input.stripe_connect_id, "stripe_connect_id"),
    currency: mustString(input.currency, "currency") as CurrencyCode,
    api_key: optionalString(input.api_key, "api_key")
  };
}

function parseFundAccount(body: unknown): Omit<FundAccountInput, "account_id"> {
  const input = mustRecord(body, "funding body");
  if (typeof input.amount !== "number") {
    throw new ZeroDOMIntegrationError("funding amount must be a number");
  }
  return {
    amount: input.amount,
    currency: mustString(input.currency, "currency") as CurrencyCode
  };
}

function authFromHeaders(headers: RestOperationInput["headers"]): AuthContext {
  const authorization = headerValue(headers, "authorization");
  const directApiKey = headerValue(headers, "x-zerodom-api-key");
  if (authorization && directApiKey) {
    throw new ZeroDOMIntegrationError("provide either Authorization or x-zerodom-api-key, not both");
  }
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (!match) {
      throw new ZeroDOMIntegrationError("Authorization must use Bearer authentication");
    }
    return { api_key: match[1] };
  }
  return { api_key: directApiKey };
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let totalLength = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalLength += buffer.length;
    if (totalLength > 1_000_000) {
      throw new ZeroDOMIntegrationError("request body exceeds 1MB limit");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    throw new ZeroDOMIntegrationError("JSON request body is required");
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function queryValue(query: Record<string, string | undefined>, key: string) {
  const value = query[key];
  return value?.trim() || undefined;
}

function expectsJsonBody(method?: string) {
  return method === "POST" || method === "PUT" || method === "PATCH";
}

function parseOutcome(value: string | undefined) {
  return value as TransactionResult | undefined;
}

function statusForError(error: unknown) {
  if (error instanceof AccountAccessError) {
    return /API key is (required|invalid)/.test(error.message) ? 401 : 403;
  }
  if (error instanceof CardIssueError) {
    return 404;
  }
  if (error instanceof ScopeValidationError || error instanceof ZeroDOMIntegrationError || error instanceof SyntaxError) {
    return 400;
  }
  return 500;
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "Error";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function headerValue(headers: RestOperationInput["headers"], key: string) {
  if (!headers) return undefined;
  const exact = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(exact)) {
    throw new ZeroDOMIntegrationError(`${key} must have exactly one value`);
  }
  return exact?.trim() || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mustRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ZeroDOMIntegrationError(`${label} must be an object`);
  }
  return value;
}

function mustString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ZeroDOMIntegrationError(`${label} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown, label: string) {
  if (value === undefined) return undefined;
  return mustString(value, label);
}

function jsonRpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
