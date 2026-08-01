import type { CardIssuerClient } from "./issuer.js";
import type { CardRecord, TransactionAttempt, TransactionRequest } from "./models.js";

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
