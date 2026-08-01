import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Account, AccountStatus, CurrencyCode } from "./models.js";

export interface CreateAccountInput {
  accountId?: string;
  stripeConnectId: string;
  currency: CurrencyCode;
  initialBalance: number;
  apiKey?: string;
  status?: AccountStatus;
  now?: Date;
}

export interface AccountCredential {
  account: PublicAccount;
  api_key: string;
}

export type PublicAccount = Omit<Account, "api_key_hash">;

export class AccountAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountAccessError";
  }
}

interface Reservation {
  account_id: string;
  task_id: string;
  amount: number;
  currency: CurrencyCode;
}

export class SandboxAccountStore {
  #accounts = new Map<string, Account>();
  #reservations = new Map<string, Reservation>();
  #sequence = 0;

  createAccount({
    accountId,
    stripeConnectId,
    currency,
    initialBalance,
    apiKey = generateApiKey(),
    status = "active",
    now = new Date()
  }: CreateAccountInput): AccountCredential {
    if (!stripeConnectId || !stripeConnectId.startsWith("acct_")) {
      throw new AccountAccessError("Stripe Connect account ID must start with acct_");
    }
    if (!currency || !/^[a-z]{3}$/.test(currency)) {
      throw new AccountAccessError("account currency must be a lowercase ISO currency code");
    }
    if (!Number.isInteger(initialBalance) || initialBalance < 0) {
      throw new AccountAccessError("initialBalance must be a non-negative integer in minor currency units");
    }
    if (!apiKey || !apiKey.startsWith("zd_test_")) {
      throw new AccountAccessError("sandbox account API key must start with zd_test_");
    }

    this.#sequence += 1;
    const account: Account = {
      account_id: accountId ?? `account_${String(this.#sequence).padStart(6, "0")}`,
      stripe_connect_id: stripeConnectId,
      api_key_hash: hashApiKey(apiKey),
      created_at: now.toISOString(),
      status,
      currency,
      available_balance: initialBalance
    };
    if (this.#accounts.has(account.account_id)) {
      throw new AccountAccessError(`account ${account.account_id} already exists`);
    }
    this.#accounts.set(account.account_id, account);

    return {
      account: publicAccount(account),
      api_key: apiKey
    };
  }

  authenticateApiKey(apiKey: string | undefined): PublicAccount {
    if (!apiKey) {
      throw new AccountAccessError("account API key is required");
    }
    for (const account of this.#accounts.values()) {
      if (verifyApiKey(apiKey, account.api_key_hash)) {
        this.#assertActive(account);
        return publicAccount(account);
      }
    }
    throw new AccountAccessError("account API key is invalid");
  }

  getAccount(accountId: string): PublicAccount {
    return publicAccount(this.#mustGetAccount(accountId));
  }

  accountIds(): string[] {
    return [...this.#accounts.keys()];
  }

  fundAccount(accountId: string, amount: number, currency: CurrencyCode): PublicAccount {
    const account = this.#mustGetAccount(accountId);
    this.#assertActive(account);
    assertAmount(amount, "funding amount");
    this.#assertCurrency(account, currency);
    account.available_balance += amount;
    return publicAccount(account);
  }

  reserveTask(accountId: string, taskId: string, amount: number, currency: CurrencyCode): PublicAccount {
    const account = this.#mustGetAccount(accountId);
    this.#assertActive(account);
    this.#assertCurrency(account, currency);
    assertAmount(amount, "reservation amount");
    const reservationKey = taskReservationKey(accountId, taskId);
    if (this.#reservations.has(reservationKey)) {
      throw new AccountAccessError(`task ${taskId} already has a balance reservation`);
    }
    if (account.available_balance < amount) {
      throw new AccountAccessError(
        `account ${accountId} has insufficient funded balance: available ${account.available_balance}, required ${amount}`
      );
    }
    account.available_balance -= amount;
    this.#reservations.set(reservationKey, {
      account_id: accountId,
      task_id: taskId,
      amount,
      currency
    });
    return publicAccount(account);
  }

  settleTask(accountId: string, taskId: string, approvedAmount: number): PublicAccount {
    const account = this.#mustGetAccount(accountId);
    const reservation = this.#mustGetReservation(accountId, taskId);
    assertAmount(approvedAmount, "approved amount");
    if (approvedAmount > reservation.amount) {
      throw new AccountAccessError(`approved amount ${approvedAmount} exceeds reserved amount ${reservation.amount}`);
    }
    account.available_balance += reservation.amount - approvedAmount;
    this.#reservations.delete(taskReservationKey(accountId, taskId));
    return publicAccount(account);
  }

  releaseTask(accountId: string, taskId: string): PublicAccount {
    const account = this.#mustGetAccount(accountId);
    const reservation = this.#reservations.get(taskReservationKey(accountId, taskId));
    if (!reservation) {
      return publicAccount(account);
    }
    if (reservation.account_id !== accountId) {
      throw new AccountAccessError(`task ${taskId} does not belong to account ${accountId}`);
    }
    account.available_balance += reservation.amount;
    this.#reservations.delete(taskReservationKey(accountId, taskId));
    return publicAccount(account);
  }

  #mustGetAccount(accountId: string) {
    const account = this.#accounts.get(accountId);
    if (!account) {
      throw new AccountAccessError(`unknown account ${accountId}`);
    }
    return account;
  }

  #mustGetReservation(accountId: string, taskId: string) {
    const reservation = this.#reservations.get(taskReservationKey(accountId, taskId));
    if (!reservation) {
      throw new AccountAccessError(`task ${taskId} has no active balance reservation`);
    }
    if (reservation.account_id !== accountId) {
      throw new AccountAccessError(`task ${taskId} does not belong to account ${accountId}`);
    }
    return reservation;
  }

  #assertActive(account: Account) {
    if (account.status !== "active") {
      throw new AccountAccessError(`account ${account.account_id} is ${account.status}`);
    }
  }

  #assertCurrency(account: Account, currency: CurrencyCode) {
    if (account.currency !== currency) {
      throw new AccountAccessError(`account ${account.account_id} is funded in ${account.currency}, not ${currency}`);
    }
  }
}

export function publicAccount(account: Account): PublicAccount {
  const { api_key_hash: _apiKeyHash, ...safeAccount } = account;
  return structuredClone(safeAccount);
}

function assertAmount(amount: number, label: string) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AccountAccessError(`${label} must be a positive integer in minor currency units`);
  }
}

function generateApiKey() {
  return `zd_test_${randomBytes(24).toString("hex")}`;
}

function taskReservationKey(accountId: string, taskId: string) {
  return `${accountId}:${taskId}`;
}

function hashApiKey(apiKey: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(apiKey, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verifyApiKey(apiKey: string, apiKeyHash: string) {
  const [salt, expected] = apiKeyHash.split(":");
  if (!salt || !expected) {
    return false;
  }
  const actualBuffer = scryptSync(apiKey, salt, 32);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
