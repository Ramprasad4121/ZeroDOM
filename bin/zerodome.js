#!/usr/bin/env node

const command = process.argv[2] ?? "demo";

if (command === "--help" || command === "-h" || command === "help") {
  console.log(`ZeroDOM

Usage:
  zerodome demo             Run the visible browser payment demo
  zerodome demo:headless    Run the same flow headlessly
  zerodome self-test        Alias for the server security preflight
  zerodome test-server      Run the named server security preflight

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
} else if (command === "demo:headless") {
  process.env.HEADLESS = "1";
  await import("../scripts/run-demo.js");
} else if (command === "demo") {
  await import("../scripts/run-demo.js");
} else {
  console.error(`Unknown ZeroDOM command: ${command}`);
  process.exit(1);
}
