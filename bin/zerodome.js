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

Environment:
  ZERODOME_PORT=4020        Local server port for demo/start
  PORT=4020                 Fallback port if ZERODOME_PORT is unset
  HEADLESS=1                Force headless Playwright mode
  SCREENSHOT_PATH=/tmp/z.png Save a screenshot after unlock
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
} else if (command === "demo:headless") {
  process.env.HEADLESS = "1";
  await import("../scripts/run-demo.js");
} else if (command === "demo") {
  await import("../scripts/run-demo.js");
} else {
  console.error(`Unknown ZeroDOM command: ${command}`);
  process.exit(1);
}
