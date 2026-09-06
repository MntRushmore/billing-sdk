/**
 * Conformance suite for BillingProvider implementations.
 *
 * Every adapter must pass this suite to be considered compliant.
 * The suite tests the contract, not provider-specific behavior.
 */

import { describe, it, expect, afterEach } from "vitest";
import type { BillingProvider, WebhookRequest, Entitlement } from "../types.js";
import { WebhookVerificationError } from "../types.js";

// ---------------------------------------------------------------------------
// Test harness interface — adapters must implement this for testing
// ---------------------------------------------------------------------------

/**
 * Test harness that adapters provide to enable conformance testing.
 * This abstracts away provider-specific setup while testing universal behavior.
 */
export interface ConformanceTestHarness {
  /**
   * Create a subscription for a customer, returning enough info to verify entitlement.
   * This simulates what happens after a successful checkout + payment.
   */
  createSubscription(opts: {
    customerRef: string;
    priceId: string;
    productId: string;
  }): Promise<{ subscriptionId: string }>;

  /**
   * Generate a valid, signed webhook request for the given event type.
   * The harness knows how to sign requests for its provider.
   */
  createWebhookRequest(opts: {
    type: "subscription.created" | "subscription.canceled" | "subscription.ended" | "unknown";
    subscriptionId?: string;
    customerRef?: string;
  }): Promise<WebhookRequest>;

  /**
   * Generate an INVALID webhook request (bad signature).
   */
  createInvalidWebhookRequest(): Promise<WebhookRequest>;

  /**
   * Schedule cancellation for a subscription (cancel at period end).
   */
  cancelSubscription(subscriptionId: string): Promise<void>;

  /**
   * Immediately end a subscription (revoke access now).
   */
  endSubscription(subscriptionId: string): Promise<void>;

  /**
   * Clean up any state created during tests.
   */
  cleanup(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Conformance suite
// ---------------------------------------------------------------------------

/**
 * Run the full conformance suite against a provider.
 *
 * @example
 * ```ts
 * import { describe } from "vitest";
 * import { runConformanceSuite } from "@fuime/billing-sdk/conformance";
 * import { mock } from "@fuime/billing-sdk/mock";
 *
 * describe("mock adapter conformance", () => {
 *   const provider = mock();
 *   runConformanceSuite(provider, createMockHarness(provider));
 * });
 * ```
 */
export function runConformanceSuite(
  provider: BillingProvider,
  harness: ConformanceTestHarness
): void {
  describe(`${provider.name} conformance`, () => {
    // Clean up after each test
    afterEach(async () => {
      await harness.cleanup();
    });

    describe("provider basics", () => {
      it("has a non-empty name", () => {
        expect(provider.name).toBeTruthy();
        expect(typeof provider.name).toBe("string");
      });

      it("has capabilities object with all required fields", () => {
        expect(provider.capabilities).toBeDefined();
        expect(typeof provider.capabilities.webhookVerification).toBe("boolean");
        expect(typeof provider.capabilities.customerPortal).toBe("boolean");
        expect(typeof provider.capabilities.merchantOfRecord).toBe("boolean");
        expect(typeof provider.capabilities.usageBilling).toBe("boolean");
        expect(typeof provider.capabilities.proration).toBe("boolean");
        expect(typeof provider.capabilities.refunds).toBe("boolean");
      });

      it("exposes native escape hatch", () => {
        expect(provider.native).toBeDefined();
      });

      it("optional methods match capabilities", () => {
        if (provider.capabilities.customerPortal) {
          expect(typeof provider.createPortalSession).toBe("function");
        }
        if (provider.capabilities.refunds) {
          expect(typeof provider.refund).toBe("function");
        }
      });
    });

    describe("createCheckout", () => {
      it("returns a checkout with id, url, and provider", async () => {
        const checkout = await provider.createCheckout({
          priceId: "price_test_123",
          customerRef: "user_conformance_test",
          successUrl: "https://example.com/success",
        });

        expect(checkout.id).toBeTruthy();
        expect(typeof checkout.id).toBe("string");
        expect(checkout.url).toBeTruthy();
        expect(checkout.url).toMatch(/^https?:\/\//);
        expect(checkout.provider).toBe(provider.name);
      });

      it("accepts optional cancelUrl and metadata", async () => {
        const checkout = await provider.createCheckout({
          priceId: "price_test_123",
          customerRef: "user_conformance_test",
          successUrl: "https://example.com/success",
          cancelUrl: "https://example.com/cancel",
          metadata: { campaign: "test" },
        });

        expect(checkout.id).toBeTruthy();
        expect(checkout.url).toBeTruthy();
      });
    });

    describe("webhook verification", () => {
      it("throws WebhookVerificationError on invalid signature", async () => {
        const invalidReq = await harness.createInvalidWebhookRequest();

        await expect(provider.handleWebhook(invalidReq)).rejects.toThrow(
          WebhookVerificationError
        );
      });

      it("throws WebhookVerificationError, not a generic Error", async () => {
        const invalidReq = await harness.createInvalidWebhookRequest();

        try {
          await provider.handleWebhook(invalidReq);
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(WebhookVerificationError);
        }
      });
    });

    describe("unmapped events", () => {
      it("returns unmapped event for unrecognized event types", async () => {
        // First create a subscription so we have valid state
        const { subscriptionId } = await harness.createSubscription({
          customerRef: "user_unmapped_test",
          priceId: "price_test",
          productId: "prod_test",
        });

        const webhookReq = await harness.createWebhookRequest({
          type: "unknown",
          subscriptionId,
          customerRef: "user_unmapped_test",
        });

        const event = await provider.handleWebhook(webhookReq);

        expect(event.type).toBe("unmapped");
        if (event.type === "unmapped") {
          expect(event.providerType).toBeTruthy();
          expect(event.raw).toBeDefined();
        }
      });

      it("never returns null for unknown events", async () => {
        const { subscriptionId } = await harness.createSubscription({
          customerRef: "user_null_test",
          priceId: "price_test",
          productId: "prod_test",
        });

        const webhookReq = await harness.createWebhookRequest({
          type: "unknown",
          subscriptionId,
          customerRef: "user_null_test",
        });

        const event = await provider.handleWebhook(webhookReq);
        expect(event).not.toBeNull();
        expect(event).toBeDefined();
      });
    });

    describe("getEntitlement", () => {
      it("returns null for unknown customers", async () => {
        const entitlement = await provider.getEntitlement(
          "nonexistent_customer_xyz_" + Date.now()
        );
        expect(entitlement).toBeNull();
      });

      it("returns entitlement for known customers", async () => {
        const customerRef = "user_entitlement_test_" + Date.now();

        await harness.createSubscription({
          customerRef,
          priceId: "price_test",
          productId: "prod_test",
        });

        const entitlement = await provider.getEntitlement(customerRef);

        expect(entitlement).not.toBeNull();
        expect(entitlement!.customerRef).toBe(customerRef);
        expect(entitlement!.provider).toBe(provider.name);
      });

      it("entitlement has all required fields", async () => {
        const customerRef = "user_fields_test_" + Date.now();

        await harness.createSubscription({
          customerRef,
          priceId: "price_test",
          productId: "prod_test",
        });

        const entitlement = await provider.getEntitlement(customerRef);

        expect(entitlement).not.toBeNull();
        expect(typeof entitlement!.active).toBe("boolean");
        expect(["trialing", "active", "past_due", "canceled", "expired"]).toContain(
          entitlement!.status
        );
        expect(typeof entitlement!.productId).toBe("string");
        expect(typeof entitlement!.customerRef).toBe("string");
        expect(typeof entitlement!.cancelAtPeriodEnd).toBe("boolean");
        expect(typeof entitlement!.provider).toBe("string");
        // periodEnd can be Date or null
        if (entitlement!.periodEnd !== null) {
          expect(entitlement!.periodEnd).toBeInstanceOf(Date);
        }
      });
    });

    describe("active consistency", () => {
      it("active=true when status is active and within period", async () => {
        const customerRef = "user_active_test_" + Date.now();

        await harness.createSubscription({
          customerRef,
          priceId: "price_test",
          productId: "prod_test",
        });

        const entitlement = await provider.getEntitlement(customerRef);

        expect(entitlement).not.toBeNull();
        expect(entitlement!.status).toBe("active");
        expect(entitlement!.active).toBe(true);
      });

      it("active=true when canceled but still within period", async () => {
        const customerRef = "user_canceled_test_" + Date.now();

        const { subscriptionId } = await harness.createSubscription({
          customerRef,
          priceId: "price_test",
          productId: "prod_test",
        });

        await harness.cancelSubscription(subscriptionId);

        const entitlement = await provider.getEntitlement(customerRef);

        expect(entitlement).not.toBeNull();
        expect(entitlement!.status).toBe("canceled");
        expect(entitlement!.active).toBe(true); // CRITICAL: still has access
        expect(entitlement!.cancelAtPeriodEnd).toBe(true);
      });

      it("active=false when subscription has ended", async () => {
        const customerRef = "user_ended_test_" + Date.now();

        const { subscriptionId } = await harness.createSubscription({
          customerRef,
          priceId: "price_test",
          productId: "prod_test",
        });

        await harness.endSubscription(subscriptionId);

        const entitlement = await provider.getEntitlement(customerRef);

        expect(entitlement).not.toBeNull();
        expect(entitlement!.status).toBe("expired");
        expect(entitlement!.active).toBe(false); // CRITICAL: no access
      });
    });

    describe("customerRef round-trip", () => {
      it("customerRef survives checkout -> subscription -> entitlement", async () => {
        const customerRef = "user_roundtrip_" + Date.now();

        // Create subscription (simulates post-checkout)
        await harness.createSubscription({
          customerRef,
          priceId: "price_test",
          productId: "prod_test",
        });

        // Retrieve entitlement
        const entitlement = await provider.getEntitlement(customerRef);

        expect(entitlement).not.toBeNull();
        expect(entitlement!.customerRef).toBe(customerRef);
      });

      it("customerRef appears in webhook events", async () => {
        const customerRef = "user_webhook_ref_" + Date.now();

        const { subscriptionId } = await harness.createSubscription({
          customerRef,
          priceId: "price_test",
          productId: "prod_test",
        });

        const webhookReq = await harness.createWebhookRequest({
          type: "subscription.created",
          subscriptionId,
          customerRef,
        });

        const event = await provider.handleWebhook(webhookReq);

        expect(event.customerRef).toBe(customerRef);
      });
    });

    describe("canceled vs ended distinction", () => {
      it("subscription.canceled event has active=true entitlement", async () => {
        const customerRef = "user_cancel_event_" + Date.now();

        const { subscriptionId } = await harness.createSubscription({
          customerRef,
          priceId: "price_test",
          productId: "prod_test",
        });

        await harness.cancelSubscription(subscriptionId);

        const webhookReq = await harness.createWebhookRequest({
          type: "subscription.canceled",
          subscriptionId,
          customerRef,
        });

        const event = await provider.handleWebhook(webhookReq);

        expect(event.type).toBe("subscription.canceled");
        if (event.type === "subscription.canceled") {
          expect(event.entitlement.active).toBe(true);
          expect(event.entitlement.cancelAtPeriodEnd).toBe(true);
        }
      });

      it("subscription.ended event has active=false entitlement", async () => {
        const customerRef = "user_end_event_" + Date.now();

        const { subscriptionId } = await harness.createSubscription({
          customerRef,
          priceId: "price_test",
          productId: "prod_test",
        });

        await harness.endSubscription(subscriptionId);

        const webhookReq = await harness.createWebhookRequest({
          type: "subscription.ended",
          subscriptionId,
          customerRef,
        });

        const event = await provider.handleWebhook(webhookReq);

        expect(event.type).toBe("subscription.ended");
        if (event.type === "subscription.ended") {
          expect(event.entitlement.active).toBe(false);
        }
      });
    });
  });
}

// Re-export for convenience
export { afterEach } from "vitest";
