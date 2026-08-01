import { describe, expect, it } from "vitest";
import {
  PlaywrightCheckoutExecutor,
  SandboxCardIssuerClient,
  defineTaskScope,
  type PlaywrightPageLike
} from "../../src/core/index.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("PlaywrightCheckoutExecutor", () => {
  it("fills checkout card fields, authorizes in-scope checkout, and returns redacted telemetry", async () => {
    const issuer = new SandboxCardIssuerClient();
    const issued = issuer.mintCard(
      defineTaskScope({
        taskDescription: "Browser checkout within scope",
        taskId: "task_playwright_checkout",
        maxAmount: 5_000,
        currency: "usd",
        merchantLock: { type: "merchant_category", value: "computer_software_stores" },
        ttlSeconds: 300,
        now: NOW
      }),
      NOW
    );
    const page = new FakeCheckoutPage({
      "#amount": { text: "$42.00", attrs: { "data-amount-minor": "4200" } },
      "#merchant": { text: "Sandbox Laptop Store" },
      "#category": { attrs: { "data-merchantCategory": "computer_software_stores" } }
    });
    const executor = new PlaywrightCheckoutExecutor(issuer);

    const result = await executor.runCheckout({
      page,
      issuedCard: issued,
      selectors: checkoutSelectors(),
      now: NOW
    });
    const telemetry = JSON.stringify(result.telemetry);

    expect(page.fills).toMatchObject({
      "#card-number": issued.card_details.number,
      "#cvc": issued.card_details.cvc,
      "#exp-month": "12",
      "#exp-year": String(issued.card_details.exp_year)
    });
    expect(page.clicks).toEqual(["#submit"]);
    expect(result.attempt).toMatchObject({
      attempted_amount: 4_200,
      attempted_merchant: "Sandbox Laptop Store",
      attempted_merchant_category: "computer_software_stores",
      result: "approved"
    });
    expect(result.card.status).toBe("used");
    expect(result.telemetry.map((event) => event.event)).toEqual([
      "filled_card_details",
      "submitted_checkout",
      "authorization_result"
    ]);
    expect(telemetry).toContain(issued.card_details.last4);
    expect(telemetry).not.toContain(issued.card_details.number);
    expect(telemetry).not.toContain(issued.card_details.cvc);
  });

  it("declines hostile checkout metadata above the scope cap", async () => {
    const issuer = new SandboxCardIssuerClient();
    const issued = issuer.mintCard(
      defineTaskScope({
        taskDescription: "Hostile checkout attempts over-cap charge",
        taskId: "task_playwright_over_cap",
        maxAmount: 2_000,
        currency: "usd",
        merchantLock: { type: "merchant_category", value: "computer_software_stores" },
        ttlSeconds: 300,
        now: NOW
      }),
      NOW
    );
    const page = new FakeCheckoutPage({
      "#amount": { attrs: { "data-amount-minor": "2100" } },
      "#merchant": { text: "Sandbox Laptop Store" },
      "#category": { attrs: { "data-merchantCategory": "computer_software_stores" } }
    });
    const executor = new PlaywrightCheckoutExecutor(issuer);

    const result = await executor.runCheckout({
      page,
      issuedCard: issued,
      selectors: checkoutSelectors(),
      now: NOW
    });

    expect(result.attempt.result).toBe("declined_amount");
    expect(result.card.status).toBe("active");
    expect(issuer.auditLog.byOutcome("declined_amount")).toHaveLength(1);
  });

  it("blocks a second browser checkout attempt on a single-use card", async () => {
    const issuer = new SandboxCardIssuerClient();
    const issued = issuer.mintCard(
      defineTaskScope({
        taskDescription: "Browser prompt injection attempts second checkout",
        taskId: "task_playwright_second_charge",
        maxAmount: 5_000,
        currency: "usd",
        merchantLock: { type: "merchant_name", value: "Sandbox Laptop Store" },
        ttlSeconds: 300,
        now: NOW
      }),
      NOW
    );
    const page = new FakeCheckoutPage({
      "#amount": { attrs: { "data-amount-minor": "4200" } },
      "#merchant": { text: "Sandbox Laptop Store" }
    });
    const executor = new PlaywrightCheckoutExecutor(issuer);

    const first = await executor.runCheckout({
      page,
      issuedCard: issued,
      selectors: { ...checkoutSelectors(), merchantCategory: undefined },
      now: NOW
    });
    const second = await executor.runCheckout({
      page,
      issuedCard: issued,
      selectors: { ...checkoutSelectors(), merchantCategory: undefined },
      now: NOW
    });

    expect(first.attempt.result).toBe("approved");
    expect(second.attempt.result).toBe("declined_reused");
    expect(issuer.auditLog.byOutcome("declined_reused")).toHaveLength(1);
  });
});

function checkoutSelectors() {
  return {
    cardNumber: "#card-number",
    cvc: "#cvc",
    expMonth: "#exp-month",
    expYear: "#exp-year",
    submit: "#submit",
    amount: "#amount",
    merchant: "#merchant",
    merchantCategory: "#category"
  };
}

interface FakeNode {
  text?: string;
  attrs?: Record<string, string>;
}

class FakeCheckoutPage implements PlaywrightPageLike {
  readonly fills: Record<string, string> = {};
  readonly clicks: string[] = [];

  constructor(private readonly nodes: Record<string, FakeNode>) {}

  locator(selector: string) {
    return {
      fill: async (value: string) => {
        this.fills[selector] = value;
      },
      click: async () => {
        this.clicks.push(selector);
      },
      textContent: async () => this.nodes[selector]?.text ?? null,
      getAttribute: async (name: string) => this.nodes[selector]?.attrs?.[name] ?? null
    };
  }
}
