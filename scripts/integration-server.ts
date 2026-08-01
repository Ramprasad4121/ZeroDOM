import { createZeroDOMRestServer, ZeroDOMIntegrationService } from "../src/core/index.js";

const port = Number.parseInt(process.env.ZERODOM_INTEGRATION_PORT ?? process.env.PORT ?? "4080", 10);
const host = process.env.ZERODOM_HOST ?? "127.0.0.1";
const service = new ZeroDOMIntegrationService();
const server = createZeroDOMRestServer({ service });
const expirySweepMs = Number(process.env.ZERODOM_EXPIRY_SWEEP_MS ?? "1000");
const expiryTimer = Number.isInteger(expirySweepMs) && expirySweepMs > 0
  ? setInterval(() => service.expireDueCards(), expirySweepMs)
  : undefined;
expiryTimer?.unref();

server.listen(port, host, () => {
  console.log(`ZeroDOM REST integration server listening at http://${host}:${port}`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

server.on("close", () => expiryTimer && clearInterval(expiryTimer));
