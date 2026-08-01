import { startServer } from "../src/server.js";
import { decodeBase64Json, encodeBase64Json, signPaymentRequired } from "../src/payment.js";

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

  const paymentPayload = await signPaymentRequired(paymentRequired);
  assert(paymentPayload.resource.url === url, "payment payload should echo the requested resource");
  assert(Object.keys(paymentPayload.extensions).length === 0, "payment payload should carry x402 extensions");
  const paid = await fetch(url, {
    headers: {
      "PAYMENT-SIGNATURE": encodeBase64Json(paymentPayload)
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

  const replay = await fetch(url, {
    headers: {
      "PAYMENT-SIGNATURE": encodeBase64Json(paymentPayload)
    }
  });
  await assertRejectedWithFreshInvoice(replay, "same nonce replay");

  const invalidBase64 = await fetch(url, {
    headers: { "PAYMENT-SIGNATURE": "not-base64-json" }
  });
  await assertRejectedWithFreshInvoice(invalidBase64, "invalid base64 JSON");

  const invalidSignatureRequired = await getPaymentRequired(url);
  const invalidSignaturePayload = await signPaymentRequired(invalidSignatureRequired);
  invalidSignaturePayload.payload.signature = "0xdeadbeef";
  const invalidSignature = await fetch(url, {
    headers: { "PAYMENT-SIGNATURE": encodeBase64Json(invalidSignaturePayload) }
  });
  await assertRejectedWithFreshInvoice(invalidSignature, "invalid signature bytes");

  const malformedWindowRequired = await getPaymentRequired(url);
  const malformedWindowPayload = await signPaymentRequired(malformedWindowRequired);
  malformedWindowPayload.payload.authorization.validBefore = "not-a-timestamp";
  const malformedWindow = await fetch(url, {
    headers: { "PAYMENT-SIGNATURE": encodeBase64Json(malformedWindowPayload) }
  });
  await assertRejectedWithFreshInvoice(malformedWindow, "malformed authorization window");

  const wrongAmountRequired = await getPaymentRequired(url);
  const wrongAmountPayload = await signPaymentRequired(wrongAmountRequired);
  wrongAmountPayload.accepted.amount = "1";
  const wrongAmount = await fetch(url, {
    headers: { "PAYMENT-SIGNATURE": encodeBase64Json(wrongAmountPayload) }
  });
  await assertRejectedWithFreshInvoice(wrongAmount, "wrong amount");

  const expiredChallenge = await fetch(url);
  const expiredRequired = decodeBase64Json(expiredChallenge.headers.get("PAYMENT-REQUIRED"));
  const expiredPayload = await signPaymentRequired(expiredRequired);
  expiredPayload.payload.authorization.validBefore = "1";
  const expired = await fetch(url, {
    headers: {
      "PAYMENT-SIGNATURE": encodeBase64Json(expiredPayload)
    }
  });
  await assertRejectedWithFreshInvoice(expired, "expired authorization");

  console.log("self-test passed: 402, signed replay, shopping unlock, replay/expiry/malformed rejection rescue");
} finally {
  server.close();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function getPaymentRequired(url) {
  const response = await fetch(url);
  assert(response.status === 402, "expected fresh payment challenge to return 402");
  const header = response.headers.get("PAYMENT-REQUIRED");
  assert(header, "fresh payment challenge missing PAYMENT-REQUIRED");
  return decodeBase64Json(header);
}

async function assertRejectedWithFreshInvoice(response, label) {
  assert(response.status === 402, `${label} should be rejected with 402`);
  const body = await response.json();
  assert(body.error === "Payment rejected", `${label} should report Payment rejected`);
  const freshHeader = response.headers.get("PAYMENT-REQUIRED");
  assert(freshHeader, `${label} should include a fresh PAYMENT-REQUIRED header`);
  const freshInvoice = decodeBase64Json(freshHeader);
  assert(freshInvoice.x402Version === 2, `${label} fresh invoice should be x402 v2`);
}
