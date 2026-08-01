import { ethers } from "ethers";

export const X402_VERSION = 2;
export const NETWORK = "eip155:84532";
export const CHAIN_ID = 84532;
export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const PRICE_USDC = "0.05";
export const PRICE_UNITS = ethers.parseUnits(PRICE_USDC, 6).toString();

// Hardhat demo keys. They are public, disposable, and must never hold real funds.
export const DEMO_BUYER_PRIVATE_KEY =
  process.env.DEMO_BUYER_PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cb1257c951ee0872844ae7f2";

export const DEMO_SERVER_PRIVATE_KEY =
  process.env.DEMO_SERVER_PRIVATE_KEY ??
  "0x1111111111111111111111111111111111111111111111111111111111111111";

export const buyerWallet = new ethers.Wallet(DEMO_BUYER_PRIVATE_KEY);
export const serverWallet = new ethers.Wallet(DEMO_SERVER_PRIVATE_KEY);

// This demo wallet will sign only this exact local invoice shape. A real agent
// would replace this with per-resource allowlists and user-configured limits.
export const DEFAULT_PAYMENT_POLICY = Object.freeze({
  scheme: "exact",
  network: NETWORK,
  asset: USDC_BASE_SEPOLIA,
  payTo: serverWallet.address,
  amount: PRICE_UNITS,
  maxTimeoutSeconds: 60
});

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
};

export function encodeBase64Json(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeBase64Json(value) {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

export function makeAuthorizationNonce() {
  return ethers.hexlify(ethers.randomBytes(32));
}

export function buildPaymentRequired({ resourceUrl, nonce, now = unixNow() }) {
  const accepts = [
    {
      scheme: "exact",
      network: NETWORK,
      amount: PRICE_UNITS,
      asset: USDC_BASE_SEPOLIA,
      payTo: serverWallet.address,
      maxTimeoutSeconds: 60,
      extra: {
        name: "USDC",
        version: "2",
        displayAmount: PRICE_USDC,
        authorizationNonce: nonce,
        validAfter: String(now - 1),
        validBefore: String(now + 60)
      }
    }
  ];

  return {
    x402Version: X402_VERSION,
    error: "PAYMENT-SIGNATURE header is required",
    resource: {
      url: resourceUrl,
      description: "ZeroDOM Premium Shopping Intelligence Report",
      mimeType: "application/json"
    },
    accepts,
    extensions: {}
  };
}

export function paymentDomain(asset = USDC_BASE_SEPOLIA) {
  return {
    name: "USD Coin",
    version: "2",
    chainId: CHAIN_ID,
    verifyingContract: asset
  };
}

export async function signPaymentRequired(
  paymentRequired,
  wallet = buyerWallet,
  policy = DEFAULT_PAYMENT_POLICY
) {
  if (paymentRequired?.x402Version !== X402_VERSION) {
    throw new Error(`Unsupported x402Version: ${paymentRequired?.x402Version}`);
  }

  const accepted = paymentRequired.accepts?.[0];
  if (!accepted) {
    throw new Error("PaymentRequired payload has no accepted payment option");
  }

  const policyError = validateAcceptedTerms(accepted, policy);
  if (policyError) {
    throw new Error(`Payment requirement violates signer policy: ${policyError}`);
  }

  const authorization = {
    from: await wallet.getAddress(),
    to: accepted.payTo,
    value: accepted.amount,
    validAfter: accepted.extra?.validAfter ?? String(unixNow() - 1),
    validBefore:
      accepted.extra?.validBefore ??
      String(unixNow() + Number(accepted.maxTimeoutSeconds ?? 60)),
    nonce: accepted.extra?.authorizationNonce
  };

  if (!authorization.nonce) {
    throw new Error("Payment requirement did not include authorization nonce");
  }
  if (!ethers.isHexString(authorization.nonce, 32)) {
    throw new Error("Payment requirement authorization nonce must be bytes32");
  }
  if (!isUnsignedInteger(authorization.validAfter) || !isUnsignedInteger(authorization.validBefore)) {
    throw new Error("Payment requirement authorization window is invalid");
  }
  if (BigInt(authorization.validBefore) <= BigInt(authorization.validAfter)) {
    throw new Error("Payment requirement authorization expiry must be after validAfter");
  }
  const now = BigInt(unixNow());
  if (BigInt(authorization.validAfter) > now + 5n) {
    throw new Error("Payment requirement is not valid yet");
  }
  if (BigInt(authorization.validBefore) <= now) {
    throw new Error("Payment requirement has already expired");
  }
  if (BigInt(authorization.validBefore) > now + BigInt(policy.maxTimeoutSeconds + 5)) {
    throw new Error("Payment requirement exceeds the signer time-window policy");
  }

  const signature = await wallet.signTypedData(
    paymentDomain(accepted.asset),
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    authorization
  );
  const parsed = ethers.Signature.from(signature);

  return {
    x402Version: X402_VERSION,
    resource: paymentRequired.resource,
    accepted,
    payload: {
      authorization,
      signature,
      signatureComponents: {
        v: parsed.v,
        r: parsed.r,
        s: parsed.s
      }
    },
    extensions: paymentRequired.extensions ?? {}
  };
}

export function verifyPaymentPayload(paymentPayload, { issuedNonces, spentNonces }) {
  try {
    if (paymentPayload?.x402Version !== X402_VERSION) {
      return fail(`unsupported x402Version ${paymentPayload?.x402Version}`);
    }

    const accepted = paymentPayload.accepted;
    const authorization = paymentPayload.payload?.authorization;
    const signature = paymentPayload.payload?.signature;

    if (!accepted || !authorization || !signature) {
      return fail("payment payload missing accepted terms, authorization, or signature");
    }

    const termsError = validateAcceptedTerms(accepted);
    if (termsError) {
      return fail(termsError);
    }

    const authorizationChecks = [
      [sameAddress(authorization.from, authorization.from), "authorization.from must be a valid address"],
      [sameAddress(authorization.to, serverWallet.address), "authorization.to must be this server"],
      [authorization.value === PRICE_UNITS, `authorization value must be ${PRICE_UNITS}`],
      [isUnsignedInteger(authorization.validAfter), "authorization.validAfter must be an unsigned integer"],
      [isUnsignedInteger(authorization.validBefore), "authorization.validBefore must be an unsigned integer"],
      [ethers.isHexString(authorization.nonce, 32), "authorization.nonce must be bytes32"],
      [ethers.isHexString(signature, 65), "signature must be a 65-byte ECDSA signature"]
    ];

    for (const [ok, reason] of authorizationChecks) {
      if (!ok) {
        return fail(reason);
      }
    }

    const now = BigInt(unixNow());
    if (BigInt(authorization.validAfter) > now) {
      return fail("authorization is not valid yet");
    }
    if (BigInt(authorization.validBefore) <= now) {
      return fail("authorization expired");
    }
    if (!issuedNonces.has(authorization.nonce)) {
      return fail("nonce was not issued by this server");
    }
    if (spentNonces.has(authorization.nonce)) {
      return fail("nonce was already spent");
    }

    const recovered = ethers.verifyTypedData(
      paymentDomain(accepted.asset),
      TRANSFER_WITH_AUTHORIZATION_TYPES,
      authorization,
      signature
    );

    if (!sameAddress(recovered, authorization.from)) {
      return fail("signature does not recover the authorization.from wallet");
    }

    spentNonces.add(authorization.nonce);
    issuedNonces.delete(authorization.nonce);

    return {
      ok: true,
      payer: recovered,
      amount: accepted.amount,
      displayAmount: accepted.extra?.displayAmount ?? PRICE_USDC,
      network: accepted.network,
      nonce: authorization.nonce
    };
  } catch {
    return fail("payment payload could not be verified");
  }
}

export function buildPaymentResponse(verification) {
  return {
    x402Version: X402_VERSION,
    success: verification.ok,
    network: verification.network,
    payer: verification.payer,
    amount: verification.amount,
    transaction: "",
    extensions: {},
    displayAmount: `${verification.displayAmount} USDC`,
    payTo: serverWallet.address,
    settled: false,
    settlementMode: "mock-local-verification",
    txHash: null,
    receipt:
      "Signature verified locally, nonce marked spent. Production would submit transferWithAuthorization for settlement."
  };
}

export function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function fail(reason) {
  return { ok: false, reason };
}

function sameAddress(a, b) {
  try {
    return ethers.getAddress(a) === ethers.getAddress(b);
  } catch {
    return false;
  }
}

function validateAcceptedTerms(accepted, policy = DEFAULT_PAYMENT_POLICY) {
  if (!accepted || typeof accepted !== "object") {
    return "accepted payment terms are missing";
  }

  const checks = [
    [accepted.scheme === policy.scheme, `scheme must be ${policy.scheme}`],
    [accepted.network === policy.network, `network must be ${policy.network}`],
    [sameAddress(accepted.asset, policy.asset), "asset must be Base Sepolia USDC"],
    [accepted.amount === policy.amount, `amount must be ${policy.amount}`],
    [sameAddress(accepted.payTo, policy.payTo), "payTo must be this server"],
    [accepted.maxTimeoutSeconds === policy.maxTimeoutSeconds, `maxTimeoutSeconds must be ${policy.maxTimeoutSeconds}`],
    [ethers.isHexString(accepted.extra?.authorizationNonce, 32), "authorization nonce must be bytes32"],
    [isUnsignedInteger(accepted.extra?.validAfter), "validAfter must be an unsigned integer"],
    [isUnsignedInteger(accepted.extra?.validBefore), "validBefore must be an unsigned integer"]
  ];

  for (const [ok, reason] of checks) {
    if (!ok) {
      return reason;
    }
  }

  if (BigInt(accepted.extra.validBefore) <= BigInt(accepted.extra.validAfter)) {
    return "validBefore must be after validAfter";
  }

  return null;
}

function isUnsignedInteger(value) {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
}
