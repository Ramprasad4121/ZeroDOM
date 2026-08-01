export function buildPremiumShoppingReport({ payer, network, nonce }) {
  return {
    paid: true,
    resource: "zerodome-premium-shopping-intel",
    reportId: "ZD-SHOP-402-BASE-SEPOLIA-001",
    unlockedAt: new Date().toISOString(),
    paidBy: payer,
    network,
    nonce,
    classification: "Synthetic demo intelligence, no real merchant checkout or funds",
    agentGoal:
      "Choose whether to buy a phone now, wait for a better price, or switch sellers.",
    verdict: "BUY_NOW",
    confidence: 0.94,
    product: {
      name: "iPhone 16 128GB",
      requestedByAgent: true,
      targetPriceInr: 70000
    },
    shoppingIntelligence: {
      title: "Premium cross-market purchase intelligence",
      bestPriceInr: 68999,
      seller: "Verified Marketplace A",
      sellerTrustScore: 0.96,
      deliveryEta: "1 day",
      priceHistory: "Lowest in 30 days",
      thirtyDayAverageInr: 74850,
      savingsVsAveragePct: 7.82,
      recommendation: "Buy now",
      reason:
        "The current offer is below the 30-day average, the seller has high fulfillment reliability, and one-day delivery is available."
    },
    paymentProof: {
      invariant: "A paid shopping-intel request must be accepted only once for an issued nonce.",
      evidence: [
        "Server issued a fresh 32-byte authorization nonce in PAYMENT-REQUIRED.",
        "Signer bound amount, recipient, network, validity window, and nonce into EIP-712 typed data.",
        "Server recovered the payer address from PAYMENT-SIGNATURE and marked the nonce spent before returning data."
      ],
      residualRisk: [
        "Demo uses mock settlement for speed; production should settle through a facilitator or direct onchain submission.",
        "Private keys are local disposable demo keys; production needs KMS, policy limits, and audit logs."
      ]
    },
    recommendedAction:
      "Proceed to purchase decision using the premium data. Keep actual checkout/payment execution out of this demo."
  };
}
