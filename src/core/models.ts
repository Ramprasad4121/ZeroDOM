export type CurrencyCode = Lowercase<string>;

export type MerchantLock =
  | {
      type: "merchant_name";
      value: string;
    }
  | {
      type: "merchant_category";
      value: string;
    };

export interface TaskScope {
  task_id: string;
  max_amount: number;
  currency: CurrencyCode;
  merchant_lock: MerchantLock;
  expires_at: string;
  single_use: boolean;
}

export type CardStatus = "active" | "expired" | "used" | "revoked";

export interface CardRecord {
  card_id: string;
  task_id: string;
  issuer_card_ref: string;
  status: CardStatus;
  minted_at: string;
}

export interface SandboxCardDetails {
  number: string;
  cvc: string;
  exp_month: number;
  exp_year: number;
  last4: string;
}

export type TransactionResult =
  | "approved"
  | "declined_amount"
  | "declined_merchant"
  | "declined_expired"
  | "declined_reused";

export interface TransactionAttempt {
  card_id: string;
  attempted_amount: number;
  attempted_merchant: string;
  attempted_merchant_category?: string;
  timestamp: string;
  result: TransactionResult;
  reason: string;
}

export interface TransactionRequest {
  card_id: string;
  attempted_amount: number;
  attempted_merchant: string;
  attempted_merchant_category?: string;
}

export interface IssuedCard {
  record: CardRecord;
  scope: TaskScope;
  card_details: SandboxCardDetails;
}

export type AuditEventType = "scope_defined" | "card_minted" | "transaction_attempt" | "card_expired" | "card_revoked";

export interface AuditEvent {
  event_id: string;
  type: AuditEventType;
  task_id: string;
  card_id?: string;
  timestamp: string;
  scope?: TaskScope;
  transaction?: TransactionAttempt;
  card_status?: CardStatus;
  reason?: string;
}

export interface ScopeDefinitionInput {
  taskDescription: string;
  maxAmount: number;
  currency: CurrencyCode;
  merchantLock: MerchantLock;
  ttlSeconds: number;
  singleUse?: boolean;
  now?: Date;
  taskId?: string;
}
