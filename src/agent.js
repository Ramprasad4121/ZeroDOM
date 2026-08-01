// src/agent.js
import { chromium } from "playwright";
import Stripe from "stripe";
import * as dotenv from "dotenv";
import { mintCard, revokeCard } from "./issuer.js";
import audit from "./audit.js";

// Load environment variables
dotenv.config();

/**
 * Runs an autonomous checkout process on a dynamically generated Stripe payment link.
 * 
 * @param {object} taskScope - Constraints and metadata for card creation
 * @param {number} productPriceCents - Price of the target demo item in cents
 * @returns {Promise<string>} Outcome of the checkout attempt
 */
export async function runAutonomousCheckout(taskScope, productPriceCents) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is required in environment to generate Stripe Checkout targets");
  }

  const stripe = new Stripe(stripeSecretKey);
  let cardId = null;
  let browser = null;

  try {
    // --- Step A: Mint Scoped Card & Log ---
    const card = mintCard(taskScope);
    cardId = card.card_id;
    audit.logMint(card.scope, cardId);

    // Format expiry for inputs (MM/YY)
    const expMonthStr = String(card.exp_month).padStart(2, "0");
    const expYearStr = String(card.exp_year).slice(-2);
    const expStr = `${expMonthStr}${expYearStr}`;

    // --- Step B: Create Price and Payment Link ---
    const price = await stripe.prices.create({
      currency: "usd",
      unit_amount: productPriceCents,
      product_data: {
        name: taskScope.taskDescription || "ZeroDOM Demo Scoped Purchase"
      }
    });

    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }]
    });

    console.log(`\nGenerated Stripe Checkout Target: ${paymentLink.url}`);

    // --- Step C: Launch Playwright (Non-headless for visibility) ---
    browser = await chromium.launch({
      headless: false,
      slowMo: 100 // Realistic typing/action pacing for demonstration
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    // --- Step D: Navigate to Checkout page ---
    await page.goto(paymentLink.url);

    // --- Step E: Enter Card Details via Iframe Locators ---
    // Fill Email (Main Document) first to allow form fields to initialize
    const emailInput = page.locator('input#email, input[name="email"]');
    await emailInput.waitFor({ state: "visible", timeout: 15000 });
    await emailInput.fill("agent-payer@zerodom.org");

    // Scan all active frames to find the secure payment input iframe dynamically.
    // This bypasses strict mode violations and name/count variance across Stripe templates.
    let cardFrame = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const frames = page.frames();
      for (const frame of frames) {
        const hasCardInput = await frame.locator('input[name="cardnumber"], input#cardNumber').isVisible().catch(() => false);
        if (hasCardInput) {
          cardFrame = frame;
          break;
        }
      }
      if (cardFrame) break;
      await page.waitForTimeout(500);
    }

    if (!cardFrame) {
      throw new Error("Could not find the secure payment card input iframe in Stripe Checkout page.");
    }

    // Type Card Number inside the located iframe
    const cardNumberInput = cardFrame.locator('input[name="cardnumber"], input#cardNumber');
    await cardNumberInput.click();
    await cardNumberInput.pressSequentially(card.number, { delay: 50 });

    // Fill Expiry inside located iframe
    const cardExpiryInput = cardFrame.locator('input[name="exp-date"], input#cardExpiry');
    await cardExpiryInput.click();
    await cardExpiryInput.pressSequentially(expStr, { delay: 50 });

    // Fill CVC inside located iframe
    const cardCvcInput = cardFrame.locator('input[name="cvc"], input#cardCvc');
    await cardCvcInput.click();
    await cardCvcInput.pressSequentially(card.cvc, { delay: 50 });

    // Fill Name (Main Document)
    const nameInput = page.locator('input#billingName, input[name="billingName"]');
    if (await nameInput.isVisible()) {
      await nameInput.fill("ZeroDOM Autonomous Agent");
    }

    // Fill Postal Code if requested by Stripe inside located iframe
    const postalCodeInput = cardFrame.locator('input[name="postalCode"], input#postalCode');
    if (await postalCodeInput.isVisible()) {
      await postalCodeInput.click();
      await postalCodeInput.pressSequentially("90210", { delay: 50 });
    }

    // --- Step F: Submit Form ---
    const payButton = page.locator('button[type="submit"], .SubmitButton');
    await payButton.click();

    // --- Step G: Wait for Success or Error ---
    let checkoutOutcome = "declined";
    try {
      await Promise.race([
        page.waitForURL(url => !url.includes("checkout.stripe.com"), { timeout: 15000 }),
        page.waitForSelector('.ErrorMessage, .parsed-error, [role="alert"]', { timeout: 15000 })
      ]);

      const currentUrl = page.url();
      if (!currentUrl.includes("checkout.stripe.com")) {
        checkoutOutcome = "approved";
      } else {
        const errorText = await page.locator('.ErrorMessage, .parsed-error, [role="alert"]').first().innerText().catch(() => "");
        checkoutOutcome = errorText ? `declined: ${errorText}` : "declined";
      }
    } catch (e) {
      // Timeout: evaluate fallback based on current page URL
      const currentUrl = page.url();
      checkoutOutcome = !currentUrl.includes("checkout.stripe.com") ? "approved" : "declined";
    }

    audit.logAttempt(cardId, productPriceCents, "Stripe Hosted Checkout", checkoutOutcome);
    return checkoutOutcome;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Autonomous Checkout Error: ${errorMsg}`);
    audit.logAttempt(cardId || "unknown", productPriceCents, "Stripe Hosted Checkout", `failed: ${errorMsg}`);
    throw error;
  } finally {
    // Close browser window gracefully
    if (browser) {
      await browser.close().catch(() => {});
    }
    // --- Step H: Always revoke card inside finally block ---
    if (cardId) {
      revokeCard(cardId);
      audit.logRevoke(cardId);
    }
  }
}
