import { ethers } from "ethers";
import { buyerWallet, encodeBase64Json, signPaymentRequired } from "./payment.js";

export function createDisposableWallet(privateKey = process.env.DEMO_BUYER_PRIVATE_KEY) {
  return privateKey ? new ethers.Wallet(privateKey) : ethers.Wallet.createRandom();
}

export async function generatePaymentSignature(paymentRequired, { wallet = buyerWallet } = {}) {
  const paymentPayload = await signPaymentRequired(paymentRequired, wallet);

  return {
    walletAddress: paymentPayload.payload.authorization.from,
    signature: paymentPayload.payload.signature,
    signatureComponents: paymentPayload.payload.signatureComponents,
    paymentPayload,
    encodedPaymentPayload: encodeBase64Json(paymentPayload)
  };
}

export { buyerWallet as disposableDemoWallet };
