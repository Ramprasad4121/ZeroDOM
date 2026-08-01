// @ts-ignore
import { runAutonomousCheckout } from "../src/agent.js";

// Task scope with a budget limit of 1500 cents ($15.00)
const scope = {
  taskDescription: "Autonomous checkout for Running Shoes",
  max_amount: 1500,
  currency: "usd",
  merchant_lock: { type: "merchant_name", value: "Stripe Hosted Checkout" },
  ttlSeconds: 300,
  single_use: true
};

async function run() {
  console.log("Orchestrating autonomous sandbox checkout for shoes...");
  console.log("Budget Limit: $15.00 (1500 cents)");
  console.log("Item Price: $12.00 (1200 cents) -> IN-SCOPE");
  console.log("--------------------------------------------------\n");

  try {
    // Execute Playwright checkout for a 1200 cents ($12.00) item
    const outcome = await runAutonomousCheckout(scope, 1200);
    console.log(`\nDemo completed. Final Checkout Status: ${outcome.toUpperCase()}`);
  } catch (error) {
    console.error("Shoes checkout demo failed:", error);
  }
}

run();
