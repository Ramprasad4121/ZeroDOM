#!/usr/bin/env node

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const command = process.argv[2] ?? "demo";
const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

if (command === "--help" || command === "-h" || command === "help") {
  console.log(`ZeroDOM

Usage:
  zerodome demo             Run the visible browser payment demo
  zerodome demo:headless    Run the same flow headlessly
  zerodome self-test        Alias for the server security preflight
  zerodome test-server      Run the named server security preflight
  zerodome card-demo        Run scoped virtual-card sandbox flow
  zerodome checkout-harness Run deterministic Playwright checkout harness
  zerodome stripe-smoke     Run Stripe Issuing sandbox smoke flow

Environment:
  ZERODOME_PORT=4020        Local server port for demo/start
  PORT=4020                 Fallback port if ZERODOME_PORT is unset
  HEADLESS=1                Force headless Playwright mode
  SCREENSHOT_PATH=/tmp/z.png Save a screenshot after unlock
  STRIPE_SECRET_KEY=sk_test_... Stripe Issuing sandbox secret for stripe-smoke
  STRIPE_ISSUING_CARDHOLDER_ID=ich_... Stripe Issuing sandbox cardholder
`);
  process.exit(0);
}

if (command === "self-test") {
  await import("../scripts/self-test.js");
} else if (command === "test-server") {
  await import("../scripts/test-server.js");
} else if (command === "card-demo") {
  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(rootDir, "scripts/card-sandbox-demo.ts")], {
    stdio: "inherit",
    env: process.env
  });
  process.exit(result.status ?? 1);
} else if (command === "checkout-harness") {
  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(rootDir, "scripts/playwright-checkout-harness.ts")], {
    stdio: "inherit",
    env: process.env
  });
  process.exit(result.status ?? 1);
} else if (command === "stripe-smoke" || command === "stripe-sandbox-smoke") {
  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(rootDir, "scripts/stripe-sandbox-smoke.ts")], {
    stdio: "inherit",
    env: process.env
  });
  process.exit(result.status ?? 1);
} else if (command === "demo:headless") {
  process.env.HEADLESS = "1";
  await import("../scripts/run-demo.js");
} else if (command === "demo") {
  await import("../scripts/run-demo.js");
} else {
  console.error(`Unknown ZeroDOM command: ${command}`);
  process.exit(1);
}
