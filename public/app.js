const runButton = document.querySelector("[data-run-audit]");
const agentStatus = document.querySelector("#agent-status");
const paymentStatus = document.querySelector("#payment-status");
const reportStatus = document.querySelector("#report-status");
const freeScan = document.querySelector("#free-scan strong");
const networkLog = document.querySelector("#network-log");
const report = document.querySelector("#report");
const reportBody = document.querySelector("#report-body");

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  recorder.reset();
  setAgentStatus("Analyzing");
  recorder.record("node-request", "[Agent] GET /api/public-scan");

  try {
    const scan = await fetch("/api/public-scan").then((response) => response.json());
    freeScan.textContent = displayVerdict(scan.verdict);
    recorder.record("node-request", `[Agent] Public scan verdict: ${scan.verdict}`);
    recorder.record("node-request", "[Agent] GET /api/shopping-intel");

    const response = await fetch("/api/shopping-intel");
    if (response.status === 402) {
      const invoiceHeader = response.headers.get("PAYMENT-REQUIRED");
      if (!invoiceHeader) {
        throw new Error("402 response omitted PAYMENT-REQUIRED");
      }
      window.ZeroDOMDemo.pushEvent("invoice_received", {
        paymentRequired: decodePaymentHeader(invoiceHeader)
      });
      return;
    }

    if (!response.ok) {
      throw new Error(`premium request returned HTTP ${response.status}`);
    }

    const json = await response.json();
    renderPremiumReport(json, response.headers.get("PAYMENT-RESPONSE"));
  } catch (error) {
    setAgentStatus("Blocked");
    recorder.onFailure(error.message);
    runButton.disabled = false;
  }
});

window.ZeroDOMDemo = {
  pushEvent(eventName, data = {}) {
    switch (eventName) {
      case "invoice_received":
        recorder.onIntercept(data.paymentRequired ?? data);
        break;
      case "signed":
        recorder.onSigned();
        break;
      case "replayed":
        recorder.onReplay();
        break;
      case "unlocked":
        recorder.onUnlock(data.paymentResponse ?? data);
        break;
      case "failed":
        recorder.onFailure(data.message ?? "Node payment interceptor failed");
        break;
      default:
        throw new Error(`Unknown ZeroDOM event: ${eventName}`);
    }
  },
  // Kept for direct/manual checks; the Node interceptor uses pushEvent only.
  onIntercept: (paymentRequired) => recorder.onIntercept(paymentRequired),
  onSigningStarted: () => recorder.onSigningStarted(),
  onSigned: () => recorder.onSigned(),
  onReplay: () => recorder.onReplay(),
  onFailure: (message) => recorder.onFailure(message),
  renderPremiumReport
};

class FlightRecorder {
  constructor({ networkLog, paymentStatus, timer, domActions, invoice, receipt }) {
    this.networkLog = networkLog;
    this.paymentStatus = paymentStatus;
    this.timer = timer;
    this.domActions = domActions;
    this.invoice = invoice;
    this.receipt = receipt;
    this.handshakeStartedAt = null;
    this.timerId = null;
    this.isUnlocked = false;
  }

  reset() {
    this.handshakeStartedAt = null;
    window.clearInterval(this.timerId);
    this.timerId = null;
    this.isUnlocked = false;
    this.networkLog.textContent = "Flight recorder armed.";
    this.paymentStatus.textContent = "Idle";
    this.timer.textContent = "Awaiting";
    this.domActions.textContent = "0";
    document.querySelectorAll(".node").forEach((node) => node.classList.remove("active"));
    this.setFields(this.invoice, {
      amount: "Awaiting 402",
      network: "Awaiting 402",
      recipient: "Awaiting 402",
      nonce: "Awaiting 402",
      expiry: "Awaiting 402"
    });
    this.setFields(this.receipt, {
      payer: "Awaiting 200",
      settlement: "Awaiting 200",
      message: "Awaiting 200"
    });
  }

  record(nodeId, message) {
    document.querySelector(`#${nodeId}`)?.classList.add("active");
    this.networkLog.textContent = `${this.networkLog.textContent}\n${message}`;
    this.networkLog.scrollTop = this.networkLog.scrollHeight;
  }

  onIntercept(paymentRequired) {
    if (!this.handshakeStartedAt) {
      this.handshakeStartedAt = performance.now();
      this.timerId = window.setInterval(() => this.renderElapsed(), 16);
    }
    this.paymentStatus.textContent = "Invoice received";
    this.record("node-402", "[Intercept] HTTP 402 caught");
    this.record("node-invoice", "[Invoice] PAYMENT-REQUIRED decoded");

    const accepted = paymentRequired?.accepts?.[0];
    if (!accepted) {
      this.onFailure("PAYMENT-REQUIRED had no accepted payment option");
      return;
    }

    const expiry = Number(accepted.extra?.validBefore);
    this.setFields(this.invoice, {
      amount: `${accepted.extra?.displayAmount ?? accepted.amount} USDC`,
      network: accepted.network,
      recipient: shortAddress(accepted.payTo),
      nonce: shortHex(accepted.extra?.authorizationNonce),
      expiry: Number.isFinite(expiry) ? new Date(expiry * 1000).toLocaleTimeString() : "Invalid"
    });
  }

  onSigningStarted() {
    this.paymentStatus.textContent = "Signing locally";
    this.record("node-sign", "[Signer] Preparing EIP-3009 authorization");
  }

  onSigned() {
    this.paymentStatus.textContent = "Signature ready";
    this.record("node-sign", "[Signer] EIP-3009 authorization signed");
  }

  onReplay() {
    this.paymentStatus.textContent = "Replaying request";
    this.record("node-replay", "[Execute] Replaying request with PAYMENT-SIGNATURE");
  }

  onUnlock(paymentResponse) {
    if (this.isUnlocked) {
      return;
    }
    this.isUnlocked = true;
    this.renderElapsed(true);
    window.clearInterval(this.timerId);
    this.timerId = null;
    this.paymentStatus.textContent = "Verified";
    this.record("node-200", "[Unlock] 200 OK, premium resource unlocked");
    this.setFields(this.receipt, {
      payer: shortAddress(paymentResponse?.payer),
      settlement: paymentResponse?.settlementMode ?? "mock-local-verification",
      message: paymentResponse?.receipt ?? "Receipt unavailable"
    });
  }

  onFailure(message) {
    window.clearInterval(this.timerId);
    this.timerId = null;
    this.paymentStatus.textContent = "Payment blocked";
    this.record("node-402", `[Rescue] ${message}`);
  }

  renderElapsed(final = false) {
    if (!this.handshakeStartedAt) return;
    const elapsed = Math.round(performance.now() - this.handshakeStartedAt);
    this.timer.textContent = `${elapsed} ms${final ? " verified" : ""}`;
  }

  setFields(target, values) {
    for (const [key, value] of Object.entries(values)) {
      target[key].textContent = value;
    }
  }
}

const recorder = new FlightRecorder({
  networkLog,
  paymentStatus,
  timer: document.querySelector("[data-handshake-time]"),
  domActions: document.querySelector("[data-dom-payment-actions]"),
  invoice: {
    amount: document.querySelector("[data-invoice-amount]"),
    network: document.querySelector("[data-invoice-network]"),
    recipient: document.querySelector("[data-invoice-recipient]"),
    nonce: document.querySelector("[data-invoice-nonce]"),
    expiry: document.querySelector("[data-invoice-expiry]")
  },
  receipt: {
    payer: document.querySelector("[data-receipt-payer]"),
    settlement: document.querySelector("[data-receipt-settlement]"),
    message: document.querySelector("[data-receipt-message]")
  }
});

function setAgentStatus(value) {
  agentStatus.textContent = value;
}

function renderPremiumReport(data, paymentResponseHeader) {
  report.dataset.paid = "true";
  reportStatus.textContent = "Unlocked";
  reportStatus.classList.remove("locked");
  setAgentStatus("Complete");

  let paymentResponse;
  try {
    paymentResponse = paymentResponseHeader ? decodePaymentHeader(paymentResponseHeader) : null;
  } catch {
    paymentResponse = null;
  }
  if (!recorder.isUnlocked) {
    recorder.onUnlock(paymentResponse);
  }

  reportBody.innerHTML = `
    <div class="report-grid">
      <div class="metric">
        <span>Recommendation</span>
        <strong>${escapeHtml(data.verdict)}</strong>
      </div>
      <div class="metric">
        <span>Confidence</span>
        <strong>${Math.round(data.confidence * 100)}%</strong>
      </div>
      <div class="metric">
        <span>Paid By</span>
        <strong>${shortAddress(data.paidBy)}</strong>
      </div>
    </div>
    <h2>${escapeHtml(data.shoppingIntelligence.title)}</h2>
    <p>${escapeHtml(data.shoppingIntelligence.reason)}</p>
    <div class="report-grid">
      <div class="metric">
        <span>Best Price</span>
        <strong>₹${data.shoppingIntelligence.bestPriceInr.toLocaleString("en-IN")}</strong>
      </div>
      <div class="metric">
        <span>Seller Trust</span>
        <strong>${Math.round(data.shoppingIntelligence.sellerTrustScore * 100)}%</strong>
      </div>
      <div class="metric">
        <span>Delivery ETA</span>
        <strong>${escapeHtml(data.shoppingIntelligence.deliveryEta)}</strong>
      </div>
    </div>
    <ul class="finding-list">
      ${data.paymentProof.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function decodePaymentHeader(value) {
  return JSON.parse(atob(value));
}

function shortAddress(value) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "Unavailable";
}

function shortHex(value) {
  return value ? `${value.slice(0, 10)}...${value.slice(-8)}` : "Unavailable";
}

function displayVerdict(value) {
  return value === "NEEDS_PREMIUM_SHOPPING_INTEL" ? "Paid intel needed" : value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
