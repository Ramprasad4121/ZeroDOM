import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPaymentRequired,
  buildPaymentResponse,
  decodeBase64Json,
  encodeBase64Json,
  makeAuthorizationNonce,
  PRICE_USDC,
  serverWallet,
  verifyPaymentPayload,
  X402_VERSION
} from "./payment.js";
import { buildPremiumShoppingReport } from "./report.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

export function createApp() {
  const app = express();
  const issuedNonces = new Map();
  const spentNonces = new Set();

  app.use(express.json());
  app.use(express.static(publicDir));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "ZeroDOM mock x402 paywall",
      x402Version: X402_VERSION,
      price: `${PRICE_USDC} USDC`,
      recipient: serverWallet.address
    });
  });

  app.get("/api/public-scan", (_req, res) => {
    res.json({
      paid: false,
      verdict: "NEEDS_PREMIUM_SHOPPING_INTEL",
      finding:
        "The shopping agent found several candidate offers, but needs paid market intelligence before it can choose the best action.",
      next: "/api/shopping-intel"
    });
  });

  app.get("/api/shopping-intel", (req, res) => {
    evictExpiredNonces(issuedNonces);

    const paymentHeader = req.get("PAYMENT-SIGNATURE") ?? req.get("X-PAYMENT");
    if (!paymentHeader) {
      sendPaymentRequired(req, res, issuedNonces);
      return;
    }

    let paymentPayload;
    try {
      paymentPayload = decodeBase64Json(paymentHeader);
    } catch {
      sendPaymentRejected(res, "payment header is not valid base64 JSON");
      return;
    }

    let verification;
    try {
      verification = verifyPaymentPayload(paymentPayload, {
        issuedNonces,
        spentNonces
      });
    } catch {
      verification = { ok: false, reason: "payment payload could not be verified" };
    }

    if (!verification.ok) {
      sendPaymentRejected(res, verification.reason);
      return;
    }

    const paymentResponse = buildPaymentResponse(verification);
    res
      .status(200)
      .set({
        "PAYMENT-RESPONSE": encodeBase64Json(paymentResponse),
        "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE"
      })
      .json(buildPremiumShoppingReport(verification));
  });

  return app;
}

export function startServer({
  port = process.env.ZERODOME_PORT ?? process.env.PORT ?? 4020,
  host = process.env.HOST ?? "127.0.0.1"
} = {}) {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(Number(port), host);
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve({ app, server, port: Number(port), host });
    };

    server.once("error", onError);
    server.once("listening", onListening);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { host, port } = await startServer();
  console.log(`ZeroDOM mock paywall running at http://${host}:${port}`);
}

function sendPaymentRequired(req, res, issuedNonces) {
  const nonce = makeAuthorizationNonce();
  issuedNonces.set(nonce, Date.now() + 60_000);

  const paymentRequired = buildPaymentRequired({
    resourceUrl: absoluteRequestUrl(req),
    nonce
  });
  res
    .status(402)
    .set({
      "PAYMENT-REQUIRED": encodeBase64Json(paymentRequired),
      "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE"
    })
    .json(paymentRequired);
}

function sendPaymentRejected(res, reason) {
  res.status(400).json({
    error: "BAD_PAYMENT_SIGNATURE",
    reason
  });
}

function absoluteRequestUrl(req) {
  return `${req.protocol}://${req.get("host")}${req.originalUrl}`;
}

function evictExpiredNonces(issuedNonces) {
  const now = Date.now();
  for (const [nonce, expiresAt] of issuedNonces.entries()) {
    if (expiresAt <= now) {
      issuedNonces.delete(nonce);
    }
  }
}
