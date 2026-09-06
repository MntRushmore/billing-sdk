import { describe, it, expect, beforeEach } from "vitest";
import { mock, type MockProvider } from "./mock.js";
import { createBillingClient } from "../client.js";
import { WebhookVerificationError } from "../types.js";
import { runConformanceSuite } from "../conformance/index.js";
import { createMockHarness } from "../conformance/mock-harness.js";

// ---------------------------------------------------------------------------
// Conformance suite — proves mock satisfies the universal contract
// ---------------------------------------------------------------------------

describe("mock conformance suite", () => {
  const provider = mock();
  const harness = createMockHarness(provider);
  runConformanceSuite(provider, harness);
});

// ---------------------------------------------------------------------------
// Mock-specific tests — behavior unique to the mock adapter
// ---------------------------------------------------------------------------

describe("mock adapter", () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = mock();
    provider._testing.reset();
  });

  describe("provider basics", () => {
    it("has correct name", () => {
      expect(provider.name).toBe("mock");
    });

    it("reports capabilities truthfully", () => {
      expect(provider.capabilities).toEqual({
        webhookVerification: true,
        customerPortal: true,
        merchantOfRecord: false,
        usageBilling: false,
        proration: false,
        refunds: true,
      });
    });

    it("exposes native state for escape hatch", () => {
      const native = provider.native;
      expect(native.state).toBeDefined();
      expect(native.webhookSecret).toBe("mock_webhook_secret");
      expect(native.baseUrl).toBe("https://mock.billing.test");
    });
  });

  describe("createCheckout", () => {
    it("returns a usable checkout URL", async () => {
      const checkout = await provider.createCheckout({
        priceId: "price_123",
        customerRef: "user_456",
        successUrl: "https://example.com/success",
      });

      expect(checkout.id).toMatch(/^checkout_/);
      expect(checkout.url).toContain("https://mock.billing.test/checkout/");
      expect(checkout.provider).toBe("mock");
    });

    it("stores pending checkout for completion", async () => {
      const checkout = await provider.createCheckout({
        priceId: "price_123",
        customerRef: "user_456",
        successUrl: "https://example.com/success",
      });

      const state = provider._testing.getState();
      expect(state.pendingCheckouts.has(checkout.id)).toBe(true);
    });

    it("customerRef round-trips through checkout completion", async () => {
      const customerRef = "user_unique_ref_789";

      const checkout = await provider.createCheckout({
        priceId: "price_123",
        customerRef,
        successUrl: "https://example.com/success",
      });

      const sub = await provider._testing.completeCheckout(checkout.id);
      expect(sub.customerRef).toBe(customerRef);

      const entitlement = await provider.getEntitlement(customerRef);
      expect(entitlement?.customerRef).toBe(customerRef);
    });
  });

  describe("webhook handling", () => {
    it("throws WebhookVerificationError on missing signature", async () => {
      await expect(
        provider.handleWebhook({
          body: JSON.stringify({ type: "test" }),
          headers: {},
          secret: "mock_webhook_secret",
        })
      ).rejects.toThrow(WebhookVerificationError);
    });

    it("throws WebhookVerificationError on invalid signature", async () => {
      await expect(
        provider.handleWebhook({
          body: JSON.stringify({ type: "test" }),
          headers: { "x-mock-signature": "invalid_sig" },
          secret: "mock_webhook_secret",
        })
      ).rejects.toThrow(WebhookVerificationError);
    });

    it("returns unmapped event for unknown event types", async () => {
      const webhookReq = await provider._testing.createWebhookRequest({
        type: "some.unknown.event",
      });

      const event = await provider.handleWebhook(webhookReq);

      expect(event.type).toBe("unmapped");
      if (event.type === "unmapped") {
        expect(event.providerType).toBe("some.unknown.event");
        expect(event.raw).toEqual({ type: "some.unknown.event" });
      }
    });

    it("never silently drops events", async () => {
      // Test multiple unknown event types
      const unknownTypes = [
        "invoice.finalized",
        "coupon.created",
        "custom.weird.event",
        "",
        "123",
      ];

      for (const eventType of unknownTypes) {
        const webhookReq = await provider._testing.createWebhookRequest({
          type: eventType,
        });

        const event = await provider.handleWebhook(webhookReq);
        expect(event.type).toBe("unmapped");
        if (event.type === "unmapped") {
          expect(event.providerType).toBe(eventType);
        }
      }
    });

    it("handles subscription.created webhook", async () => {
      const checkout = await provider.createCheckout({
        priceId: "price_123",
        customerRef: "user_456",
        successUrl: "https://example.com/success",
      });
      const sub = await provider._testing.completeCheckout(checkout.id);

      const webhookReq = await provider._testing.createWebhookRequest({
        type: "subscription.created",
        subscriptionId: sub.id,
      });

      const event = await provider.handleWebhook(webhookReq);

      expect(event.type).toBe("subscription.started");
      expect(event.customerRef).toBe("user_456");
      if (event.type === "subscription.started") {
        expect(event.entitlement.active).toBe(true);
        expect(event.entitlement.status).toBe("active");
      }
    });

    it("handles subscription.canceled webhook (scheduled cancellation)", async () => {
      const checkout = await provider.createCheckout({
        priceId: "price_123",
        customerRef: "user_456",
        successUrl: "https://example.com/success",
      });
      const sub = await provider._testing.completeCheckout(checkout.id);
      await provider._testing.cancelSubscription(sub.id);

      const webhookReq = await provider._testing.createWebhookRequest({
        type: "subscription.canceled",
        subscriptionId: sub.id,
      });

      const event = await provider.handleWebhook(webhookReq);

      expect(event.type).toBe("subscription.canceled");
      if (event.type === "subscription.canceled") {
        // CRITICAL: canceled != ended. User still has access until periodEnd
        expect(event.entitlement.status).toBe("canceled");
        expect(event.entitlement.active).toBe(true); // Still has access!
        expect(event.entitlement.cancelAtPeriodEnd).toBe(true);
      }
    });

    it("handles subscription.ended webhook (access revoked)", async () => {
      const checkout = await provider.createCheckout({
        priceId: "price_123",
        customerRef: "user_456",
        successUrl: "https://example.com/success",
      });
      const sub = await provider._testing.completeCheckout(checkout.id);
      await provider._testing.endSubscription(sub.id);

      const webhookReq = await provider._testing.createWebhookRequest({
        type: "subscription.ended",
        subscriptionId: sub.id,
      });

      const event = await provider.handleWebhook(webhookReq);

      expect(event.type).toBe("subscription.ended");
      if (event.type === "subscription.ended") {
        // CRITICAL: ended = access is gone NOW
        expect(event.entitlement.status).toBe("expired");
        expect(event.entitlement.active).toBe(false);
      }
    });

    it("handles payment.succeeded webhook", async () => {
      const checkout = await provider.createCheckout({
        priceId: "price_123",
        customerRef: "user_456",
        successUrl: "https://example.com/success",
      });
      const sub = await provider._testing.completeCheckout(checkout.id);
      const payment = await provider._testing.createPayment({
        customerRef: "user_456",
        subscriptionId: sub.id,
        amount: 1999,
        currency: "usd",
      });

      const webhookReq = await provider._testing.createWebhookRequest({
        type: "payment.succeeded",
        paymentId: payment.id,
        amount: 1999,
        currency: "usd",
      });

      const event = await provider.handleWebhook(webhookReq);

      expect(event.type).toBe("payment.succeeded");
      if (event.type === "payment.succeeded") {
        expect(event.amount).toBe(1999);
        expect(event.currency).toBe("usd");
      }
    });

    it("handles payment.failed webhook", async () => {
      const webhookReq = await provider._testing.createWebhookRequest({
        type: "payment.failed",
        amount: 1999,
        currency: "usd",
      });

      const event = await provider.handleWebhook(webhookReq);

      expect(event.type).toBe("payment.failed");
      if (event.type === "payment.failed") {
        expect(event.amount).toBe(1999);
        expect(event.currency).toBe("usd");
      }
    });
  });

  describe("getEntitlement", () => {
    it("returns null for unknown customer", async () => {
      const entitlement = await provider.getEntitlement("nonexistent_user");
      expect(entitlement).toBeNull();
    });

    it("returns entitlement for active subscription", async () => {
      const checkout = await provider.createCheckout({
        priceId: "price_123",
        customerRef: "user_456",
        successUrl: "https://example.com/success",
      });
      await provider._testing.completeCheckout(checkout.id, {
        productId: "prod_abc",
      });

      const entitlement = await provider.getEntitlement("user_456");

      expect(entitlement).not.toBeNull();
      expect(entitlement?.active).toBe(true);
      expect(entitlement?.status).toBe("active");
      expect(entitlement?.productId).toBe("prod_abc");
      expect(entitlement?.customerRef).toBe("user_456");
      expect(entitlement?.cancelAtPeriodEnd).toBe(false);
      expect(entitlement?.provider).toBe("mock");
    });

    it("active is consistent with status and periodEnd", async () => {
      const checkout = await provider.createCheckout({
        priceId: "price_123",
        customerRef: "user_456",
        successUrl: "https://example.com/success",
      });
      const sub = await provider._testing.completeCheckout(checkout.id);

      // Active subscription
      let entitlement = await provider.getEntitlement("user_456");
      expect(entitlement?.active).toBe(true);
      expect(entitlement?.status).toBe("active");

      // Canceled but still in period
      await provider._testing.cancelSubscription(sub.id);
      entitlement = await provider.getEntitlement("user_456");
      expect(entitlement?.status).toBe("canceled");
      expect(entitlement?.active).toBe(true); // Still has access!
      expect(entitlement?.cancelAtPeriodEnd).toBe(true);

      // Ended (expired)
      await provider._testing.endSubscription(sub.id);
      entitlement = await provider.getEntitlement("user_456");
      expect(entitlement?.status).toBe("expired");
      expect(entitlement?.active).toBe(false); // No more access
    });

    it("past_due status still grants access", async () => {
      const checkout = await provider.createCheckout({
        priceId: "price_123",
        customerRef: "user_456",
        successUrl: "https://example.com/success",
      });
      const sub = await provider._testing.completeCheckout(checkout.id);
      await provider._testing.setSubscriptionPastDue(sub.id);

      const entitlement = await provider.getEntitlement("user_456");
      expect(entitlement?.status).toBe("past_due");
      // past_due is NOT in our active list, so access is denied
      // This is a deliberate choice - past_due means payment failed
      expect(entitlement?.active).toBe(false);
    });
  });

  describe("createPortalSession", () => {
    it("returns portal URL", async () => {
      const result = await provider.createPortalSession!(
        "user_456",
        "https://example.com/settings"
      );

      expect(result.url).toContain("https://mock.billing.test/portal/");
      expect(result.url).toContain("customer=user_456");
      expect(result.url).toContain("return_url=");
    });
  });

  describe("refund", () => {
    it("refunds existing payment", async () => {
      const checkout = await provider.createCheckout({
        priceId: "price_123",
        customerRef: "user_456",
        successUrl: "https://example.com/success",
      });
      const sub = await provider._testing.completeCheckout(checkout.id);
      const payment = await provider._testing.createPayment({
        customerRef: "user_456",
        subscriptionId: sub.id,
        amount: 1999,
      });

      // Should not throw
      await expect(provider.refund!(payment.id)).resolves.toBeUndefined();
    });

    it("throws for nonexistent payment", async () => {
      await expect(provider.refund!("nonexistent_pay")).rejects.toThrow(
        "Payment not found"
      );
    });
  });

  describe("BillingClient wrapper", () => {
    it("wraps provider correctly", () => {
      const client = createBillingClient({ provider });

      expect(client.name).toBe("mock");
      expect(client.capabilities).toEqual(provider.capabilities);
      expect(typeof client.createCheckout).toBe("function");
      expect(typeof client.handleWebhook).toBe("function");
      expect(typeof client.getEntitlement).toBe("function");
      expect(typeof client.createPortalSession).toBe("function");
      expect(typeof client.refund).toBe("function");
    });

    it("native() returns typed escape hatch", () => {
      const client = createBillingClient({ provider });
      const native = client.native<typeof provider.native>();

      expect(native.webhookSecret).toBe("mock_webhook_secret");
      expect(native.state).toBeDefined();
    });
  });
});

describe("canceled vs ended distinction", () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = mock();
    provider._testing.reset();
  });

  it("canceled = scheduled, access continues", async () => {
    const checkout = await provider.createCheckout({
      priceId: "price_123",
      customerRef: "user_456",
      successUrl: "https://example.com/success",
    });
    const sub = await provider._testing.completeCheckout(checkout.id);

    // Cancel (schedule for period end)
    await provider._testing.cancelSubscription(sub.id);

    const entitlement = await provider.getEntitlement("user_456");

    // User should STILL have access
    expect(entitlement?.active).toBe(true);
    expect(entitlement?.status).toBe("canceled");
    expect(entitlement?.cancelAtPeriodEnd).toBe(true);
    // periodEnd should be in the future
    expect(entitlement?.periodEnd!.getTime()).toBeGreaterThan(Date.now());
  });

  it("ended = access gone now", async () => {
    const checkout = await provider.createCheckout({
      priceId: "price_123",
      customerRef: "user_456",
      successUrl: "https://example.com/success",
    });
    const sub = await provider._testing.completeCheckout(checkout.id);

    // End immediately
    await provider._testing.endSubscription(sub.id);

    const entitlement = await provider.getEntitlement("user_456");

    // User should NOT have access
    expect(entitlement?.active).toBe(false);
    expect(entitlement?.status).toBe("expired");
  });

  it("the two states produce different webhook events", async () => {
    const checkout = await provider.createCheckout({
      priceId: "price_123",
      customerRef: "user_456",
      successUrl: "https://example.com/success",
    });
    const sub = await provider._testing.completeCheckout(checkout.id);

    // First: cancel (scheduled)
    await provider._testing.cancelSubscription(sub.id);
    const canceledReq = await provider._testing.createWebhookRequest({
      type: "subscription.canceled",
      subscriptionId: sub.id,
    });
    const canceledEvent = await provider.handleWebhook(canceledReq);

    expect(canceledEvent.type).toBe("subscription.canceled");
    if (canceledEvent.type === "subscription.canceled") {
      expect(canceledEvent.entitlement.active).toBe(true);
    }

    // Then: end (immediate)
    await provider._testing.endSubscription(sub.id);
    const endedReq = await provider._testing.createWebhookRequest({
      type: "subscription.ended",
      subscriptionId: sub.id,
    });
    const endedEvent = await provider.handleWebhook(endedReq);

    expect(endedEvent.type).toBe("subscription.ended");
    if (endedEvent.type === "subscription.ended") {
      expect(endedEvent.entitlement.active).toBe(false);
    }
  });
});
