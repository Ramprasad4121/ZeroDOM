import { chromium } from "playwright";
import { startServer } from "../src/server.js";
import { decodeBase64Json, encodeBase64Json, signPaymentRequired } from "../src/payment.js";

const headless = process.env.HEADLESS === "1";
const port = Number(process.env.ZERODOME_PORT ?? process.env.PORT ?? 4020);
const viewport = {
  width: Number(process.env.WIDTH ?? 1360),
  height: Number(process.env.HEIGHT ?? 860)
};
const { server, reusedServer } = await startDemoServer(port);

let browser;
try {
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(
    reusedServer
      ? `[ZeroDOM] Reusing healthy stage server: ${baseUrl}`
      : `[ZeroDOM] Demo server started: ${baseUrl}`
  );

  browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport });
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  let resolvePaymentFlow;
  let rejectPaymentFlow;
  const paymentFlow = new Promise((resolve, reject) => {
    resolvePaymentFlow = resolve;
    rejectPaymentFlow = reject;
  });

  await page.route("**/api/shopping-intel", async (route) => {
    try {
      // The first request reaches the resource server, but stays unresolved in
      // the page while Node converts the 402 challenge into a signed replay.
      const unpaidResponse = await route.fetch();
      if (unpaidResponse.status() !== 402) {
        await route.fulfill({ response: unpaidResponse });
        resolvePaymentFlow();
        return;
      }

      const unpaidHeaders = unpaidResponse.headers();
      const paymentRequiredHeader = unpaidHeaders["payment-required"];
      if (!paymentRequiredHeader) {
        throw new Error("402 response did not include PAYMENT-REQUIRED");
      }

      const paymentRequired = decodeBase64Json(paymentRequiredHeader);
      console.log("[Intercept] HTTP 402 caught");
      await pushUiEvent(page, "invoice_received", {
        paymentRequired,
        headers: unpaidHeaders
      });

      const paymentPayload = await signPaymentRequired(paymentRequired);
      const paymentSignatureHeader = encodeBase64Json(paymentPayload);
      console.log("[Signer] EIP-3009 authorization signed");
      await pushUiEvent(page, "signed", {
        signature: paymentPayload.payload.signature,
        signatureComponents: paymentPayload.payload.signatureComponents
      });

      console.log("[Execute] Replaying request with PAYMENT-SIGNATURE");
      await pushUiEvent(page, "replayed", {});
      const paidResponse = await page.request.get(route.request().url(), {
        headers: {
          "PAYMENT-SIGNATURE": paymentSignatureHeader
        }
      });
      const paidBody = await paidResponse.body();
      if (paidResponse.status() !== 200) {
        throw new Error(`Signed replay returned HTTP ${paidResponse.status()}`);
      }

      const paidHeaders = paidResponse.headers();
      const paymentResponseHeader = paidHeaders["payment-response"];
      if (!paymentResponseHeader) {
        throw new Error("200 response did not include PAYMENT-RESPONSE");
      }
      const paymentResponse = decodeBase64Json(paymentResponseHeader);
      await pushUiEvent(page, "unlocked", { paymentResponse });
      await route.fulfill({ response: paidResponse, body: paidBody });
      console.log("[Unlock] 200 OK, premium resource unlocked");
      resolvePaymentFlow();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Rescue] ${message}`);
      await pushUiEvent(page, "failed", { message }).catch(() => {});
      await route.abort("failed").catch(() => {});
      rejectPaymentFlow(error);
    }
  });

  await page.click("[data-run-audit]");
  await paymentFlow;

  await page.waitForSelector('[data-paid="true"]', { timeout: 5000 });
  const stageProof = await page.evaluate(() => ({
    domPaymentActions: document.querySelector("[data-dom-payment-actions]")?.textContent,
    handshake: document.querySelector("[data-handshake-time]")?.textContent,
    paymentStatus: document.querySelector("#payment-status")?.textContent,
    receipt: document.querySelector("[data-receipt-message]")?.textContent
  }));
  if (
    stageProof.domPaymentActions !== "0" ||
    !stageProof.handshake?.includes("ms verified") ||
    stageProof.paymentStatus !== "Verified" ||
    !stageProof.receipt?.includes("Signature verified locally")
  ) {
    throw new Error(`Flight Recorder proof is incomplete: ${JSON.stringify(stageProof)}`);
  }
  await page.waitForTimeout(100);
  const timerAfterUnlock = await page.locator("[data-handshake-time]").textContent();
  if (timerAfterUnlock !== stageProof.handshake) {
    throw new Error(`Flight Recorder timer continued after unlock: ${stageProof.handshake} -> ${timerAfterUnlock}`);
  }
  if (process.env.SCREENSHOT_PATH) {
    await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
  }
  if (!headless) {
    console.log("Browser left open for live demo. Press Ctrl+C to stop.");
    await new Promise(() => {});
  }
} finally {
  if (headless && browser) {
    await browser.close();
  }
  if (headless && server) {
    server.close();
  }
}

function pushUiEvent(page, eventName, data) {
  return page.evaluate(
    ({ eventName, data }) => window.ZeroDOMDemo.pushEvent(eventName, data),
    { eventName, data }
  );
}

async function startDemoServer(port) {
  try {
    const started = await startServer({ port });
    return { server: started.server, reusedServer: false };
  } catch (error) {
    if (error?.code !== "EADDRINUSE") {
      throw error;
    }

    let health;
    try {
      health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
    } catch {
      throw new Error(`Port ${port} is occupied and could not be verified as a ZeroDOM stage server. Use ZERODOME_PORT=4022.`);
    }

    if (health?.ok !== true || health?.x402Version !== 2) {
      throw new Error(`Port ${port} is occupied by a non-ZeroDOM service. Use ZERODOME_PORT=4022.`);
    }

    return { server: null, reusedServer: true };
  }
}
