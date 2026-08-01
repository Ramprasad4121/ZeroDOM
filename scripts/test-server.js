import { startServer } from "../src/server.js";
import { decodeBase64Json, encodeBase64Json } from "../src/payment.js";
import { generatePaymentSignature } from "../src/signer.js";

const port = Number(process.env.ZERODOME_PORT ?? process.env.PORT ?? 4021);
const { server } = await startServer({ port });

try {
  const url = `http://localhost:${port}/api/shopping-intel`;

  const unpaid = await fetch(url);
  assert(unpaid.status === 402, `expected unpaid request to return 402, got ${unpaid.status}`);
  const requiredHeader = unpaid.headers.get("PAYMENT-REQUIRED");
  assert(requiredHeader, "missing PAYMENT-REQUIRED header");
  const paymentRequired = decodeBase64Json(requiredHeader);
  assert(paymentRequired.x402Version === 2, "expected x402Version 2");
  assert(paymentRequired.accepts[0].scheme === "exact", "expected exact scheme");
  assert(paymentRequired.accepts[0].network === "eip155:84532", "expected Base Sepolia");
  pass("unpaid premium request returns 402 plus PAYMENT-REQUIRED invoice");

  const malformed = await fetch(url, {
    headers: { "PAYMENT-SIGNATURE": "not-base64-json" }
  });
  await assertBadPayment(malformed, "malformed payment header");
  pass("malformed PAYMENT-SIGNATURE returns 400 Bad Request");

  const tamperedRequired = await getPaymentRequired(url);
  const tamperedSignedPayment = await generatePaymentSignature(tamperedRequired);
  assert(
    ethersHexSignature(tamperedSignedPayment.signature),
    "signer should return a 65-byte hex ECDSA signature"
  );
  const tamperedPayload = cloneJson(tamperedSignedPayment.paymentPayload);
  tamperedPayload.payload.signature = "0xdeadbeef";
  const tampered = await fetch(url, {
    headers: { "PAYMENT-SIGNATURE": encodeBase64Json(tamperedPayload) }
  });
  await assertBadPayment(tampered, "tampered EIP-3009 signature");
  pass("hacked EIP-3009 signature returns 400 Bad Request");

  const validRequired = await getPaymentRequired(url);
  const signedPayment = await generatePaymentSignature(validRequired);
  assert(
    ethersHexSignature(signedPayment.signature),
    "signer should return a 65-byte hex ECDSA signature"
  );
  assert(signedPayment.encodedPaymentPayload, "signer should return encoded x402 payment payload");

  const paid = await fetch(url, {
    headers: {
      "PAYMENT-SIGNATURE": signedPayment.encodedPaymentPayload
    }
  });
  assert(paid.status === 200, `expected paid request to return 200, got ${paid.status}`);
  assert(paid.headers.get("PAYMENT-RESPONSE"), "missing PAYMENT-RESPONSE header");
  const paymentResponse = decodeBase64Json(paid.headers.get("PAYMENT-RESPONSE"));
  assert(paymentResponse.transaction === "", "mock payment response should not claim an onchain transaction");
  assert(paymentResponse.settled === false, "mock payment response should declare unsettlement");

  const report = await paid.json();
  assert(report.paid === true, "report should be marked paid");
  assert(report.resource === "zerodome-premium-shopping-intel", "wrong premium resource");
  assert(report.verdict === "BUY_NOW", "report should recommend a purchase action");
  assert(report.shoppingIntelligence.bestPriceInr === 68999, "shopping intelligence missing best price");
  pass("signed PAYMENT-SIGNATURE returns 200 plus premium shopping intelligence");

  const replay = await fetch(url, {
    headers: {
      "PAYMENT-SIGNATURE": signedPayment.encodedPaymentPayload
    }
  });
  await assertBadPayment(replay, "same nonce replay");
  pass("spent nonce replay returns 400 Bad Request");

  const wrongAmountRequired = await getPaymentRequired(url);
  const wrongAmountSignedPayment = await generatePaymentSignature(wrongAmountRequired);
  const wrongAmountPayload = cloneJson(wrongAmountSignedPayment.paymentPayload);
  wrongAmountPayload.accepted.amount = "1";
  const wrongAmount = await fetch(url, {
    headers: { "PAYMENT-SIGNATURE": encodeBase64Json(wrongAmountPayload) }
  });
  await assertBadPayment(wrongAmount, "wrong amount");
  pass("wrong amount returns 400 Bad Request");

  const expiredRequired = await getPaymentRequired(url);
  const expiredSignedPayment = await generatePaymentSignature(expiredRequired);
  const expiredPayload = cloneJson(expiredSignedPayment.paymentPayload);
  expiredPayload.payload.authorization.validBefore = "1";
  const expired = await fetch(url, {
    headers: {
      "PAYMENT-SIGNATURE": encodeBase64Json(expiredPayload)
    }
  });
  await assertBadPayment(expired, "expired authorization");
  pass("expired authorization returns 400 Bad Request");

  console.log("server preflight passed: 402 invoice, 400 safety catches, 200 signed unlock");
} finally {
  server.close();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function pass(message) {
  console.log(`[pass] ${message}`);
}

async function getPaymentRequired(url) {
  const response = await fetch(url);
  assert(response.status === 402, "expected fresh payment challenge to return 402");
  const header = response.headers.get("PAYMENT-REQUIRED");
  assert(header, "fresh payment challenge missing PAYMENT-REQUIRED");
  return decodeBase64Json(header);
}

async function assertBadPayment(response, label) {
  assert(response.status === 400, `${label} should return 400, got ${response.status}`);
  const body = await response.json();
  assert(body.error === "BAD_PAYMENT_SIGNATURE", `${label} should report BAD_PAYMENT_SIGNATURE`);
  assert(body.reason, `${label} should include a rejection reason`);
}

function ethersHexSignature(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{130}$/.test(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
