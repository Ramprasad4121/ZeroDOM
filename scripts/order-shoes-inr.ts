// scripts/order-shoes-inr.ts
// @ts-ignore
import { runAutonomousCheckout } from "../src/agent.js";
import { defineTaskScope } from "../src/core/index.js";

// Mock catalog of nice shoes under 1500 INR
const shoeCatalog = [
  { id: 1, name: "Bata Casual Men's Loafers", priceINR: 999, rating: 4.2 },
  { id: 2, name: "Sparx Sporty Running Shoes", priceINR: 1199, rating: 4.6 },
  { id: 3, name: "Campus Max Men's Sneakers", priceINR: 1399, rating: 4.4 }
];

async function run() {
  console.log("Analyzing product catalog for 'nice shoes under 1500 INR'...");
  console.log("------------------------------------------------------------");
  for (const shoe of shoeCatalog) {
    console.log(`- [ID: ${shoe.id}] ${shoe.name} | Price: ₹${shoe.priceINR} | Rating: ${shoe.rating}/5`);
  }

  // Select the highest rated shoe under 1500 INR
  const selectedShoe = shoeCatalog.reduce((prev, current) => (prev.rating > current.rating ? prev : current));
  console.log(`\nSelected Best Product: ${selectedShoe.name}`);
  console.log(`Price: ₹${selectedShoe.priceINR} INR (1500 INR Budget Limit)`);
  console.log("------------------------------------------------------------\n");

  // Budget Limit: 1500 INR -> converted to Paise (150,000 Paise)
  // Target Price: 1199 INR -> converted to Paise (119,900 Paise)
  const budgetPaise = 1500 * 100;
  const pricePaise = selectedShoe.priceINR * 100;

  const scope = {
    taskDescription: `Autonomous purchase of ${selectedShoe.name}`,
    max_amount: budgetPaise,
    currency: "inr",
    merchant_lock: { type: "merchant_name", value: "Stripe Hosted Checkout" },
    ttlSeconds: 300,
    single_use: true
  };

  try {
    // Run the Playwright autonomous checkout flow using INR
    const outcome = await runAutonomousCheckout(scope, pricePaise);
    console.log(`\nDemo completed. Final Checkout Status: ${outcome.toUpperCase()}`);
  } catch (error) {
    console.error("INR checkout demo failed:", error);
  }
}

run();
