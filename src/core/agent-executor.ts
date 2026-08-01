import type { CardIssuerClient } from "./issuer.js";
import type { CardRecord, IssuedCard, TransactionAttempt, TransactionRequest } from "./models.js";

export interface CheckoutStep extends Omit<TransactionRequest, "card_id"> {
  label: string;
}

export interface ScriptedExecutionResult {
  card: CardRecord;
  attempts: TransactionAttempt[];
}

export class AgentExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentExecutionError";
  }
}

export class ScriptedAgentExecutor {
  constructor(private readonly issuer: CardIssuerClient) {}

  runCheckout({ cardId, steps, now = new Date() }: { cardId: string; steps: CheckoutStep[]; now?: Date }): ScriptedExecutionResult {
    const attempts: TransactionAttempt[] = [];

    for (const step of steps) {
      const attempt = this.issuer.authorize(
        {
          card_id: cardId,
          attempted_amount: step.attempted_amount,
          attempted_merchant: step.attempted_merchant,
          attempted_merchant_category: step.attempted_merchant_category
        },
        now
      );
      attempts.push(attempt);
    }

    return {
      card: this.issuer.getStatusAndHistory(cardId).card,
      attempts
    };
  }

  simulateProcessDeath({ afterMintedCardId, at }: { afterMintedCardId: string; at: Date }) {
    const expired = this.issuer.expireCards(at);
    const card = expired.find((record) => record.card_id === afterMintedCardId) ?? this.issuer.getStatusAndHistory(afterMintedCardId).card;
    if (card.status === "active") {
      throw new AgentExecutionError(`card ${afterMintedCardId} remained active after simulated process death cleanup`);
    }
    return card;
  }
}

export interface PlaywrightPageLike {
  locator(selector: string): {
    fill(value: string): Promise<void>;
    click(): Promise<void>;
    textContent(): Promise<string | null>;
    getAttribute(name: string): Promise<string | null>;
  };
}

export interface CheckoutSelectors {
  cardNumber: string;
  cvc: string;
  expMonth: string;
  expYear: string;
  submit: string;
  amount: string;
  merchant: string;
  merchantCategory?: string;
}

export interface PlaywrightCheckoutTelemetry {
  event: "filled_card_details" | "submitted_checkout" | "authorization_result";
  card_id: string;
  last4?: string;
  result?: TransactionAttempt["result"];
  reason?: string;
}

export interface PlaywrightCheckoutResult {
  card: CardRecord;
  attempt: TransactionAttempt;
  telemetry: PlaywrightCheckoutTelemetry[];
}

export class PlaywrightCheckoutExecutor {
  constructor(private readonly issuer: CardIssuerClient) {}

  async runCheckout({
    page,
    issuedCard,
    selectors,
    now = new Date()
  }: {
    page: PlaywrightPageLike;
    issuedCard: IssuedCard;
    selectors: CheckoutSelectors;
    now?: Date;
  }): Promise<PlaywrightCheckoutResult> {
    const telemetry: PlaywrightCheckoutTelemetry[] = [];

    await page.locator(selectors.cardNumber).fill(issuedCard.card_details.number);
    await page.locator(selectors.cvc).fill(issuedCard.card_details.cvc);
    await page.locator(selectors.expMonth).fill(String(issuedCard.card_details.exp_month).padStart(2, "0"));
    await page.locator(selectors.expYear).fill(String(issuedCard.card_details.exp_year));
    telemetry.push({
      event: "filled_card_details",
      card_id: issuedCard.record.card_id,
      last4: issuedCard.card_details.last4
    });

    const attemptedAmount = await readMinorAmount(page, selectors.amount);
    const attemptedMerchant = await readTextOrData(page, selectors.merchant, "merchant");
    const attemptedMerchantCategory = selectors.merchantCategory
      ? await readTextOrData(page, selectors.merchantCategory, "merchantCategory")
      : undefined;

    await page.locator(selectors.submit).click();
    telemetry.push({
      event: "submitted_checkout",
      card_id: issuedCard.record.card_id,
      last4: issuedCard.card_details.last4
    });

    const attempt = this.issuer.authorize(
      {
        card_id: issuedCard.record.card_id,
        attempted_amount: attemptedAmount,
        attempted_merchant: attemptedMerchant,
        attempted_merchant_category: attemptedMerchantCategory
      },
      now
    );
    telemetry.push({
      event: "authorization_result",
      card_id: issuedCard.record.card_id,
      result: attempt.result,
      reason: attempt.reason
    });

    return {
      card: this.issuer.getStatusAndHistory(issuedCard.record.card_id).card,
      attempt,
      telemetry
    };
  }
}

async function readMinorAmount(page: PlaywrightPageLike, selector: string) {
  const locator = page.locator(selector);
  const raw = (await locator.getAttribute("data-amount-minor")) ?? (await locator.textContent());
  const parsed = Number.parseInt(raw?.replace(/[^\d]/g, "") ?? "", 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AgentExecutionError(`checkout amount at ${selector} must be a positive minor-unit integer`);
  }
  return parsed;
}

async function readTextOrData(page: PlaywrightPageLike, selector: string, dataName: string) {
  const locator = page.locator(selector);
  const raw = (await locator.getAttribute(`data-${dataName}`)) ?? (await locator.textContent());
  const value = raw?.trim();
  if (!value) {
    throw new AgentExecutionError(`checkout field ${selector} did not expose ${dataName}`);
  }
  return value;
}
