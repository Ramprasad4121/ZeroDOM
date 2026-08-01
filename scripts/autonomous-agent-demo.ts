// @ts-ignore
import { runAutonomousCheckout } from "../src/agent.js";
import { defineTaskScope } from "../src/core/index.js";

const scope = {
  taskDescription: "Autonomous purchase of premium SaaS subscription",
  max_amount: 1500,
  currency: "usd",
  merchant_lock: { type: "merchant_name", value: "Stripe Hosted Checkout" },
  ttlSeconds: 300,
  single_use: true
};

async function run() {
  console.log("Starting Autonomous Agent Checkout Demo...");
  try {
    const outcome = await runAutonomousCheckout(scope, 1000);
    console.log(`Demo completed. Final Outcome: ${outcome}`);
  } catch (error) {
    console.error("Demo failed:", error);
  }
}

run();
