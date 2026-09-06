/**
 * Stripe adapter unit tests.
 *
 * These tests verify the Stripe adapter's webhook handling and status mapping
 * without hitting the real Stripe API. They use the Stripe SDK's webhook
 * construction to generate properly signed test payloads.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import Stripe from "stripe";
import { stripe, type StripeProvider } from "./stripe.js";
import { WebhookVerificationError } from "../types.js";
import { createHmac } from "node:crypto";

// Test webhook secret - used for signing test payloads
const TEST_WEBHOOK_SECRET = "whsec_test_secret_for_unit_tests";
const TEST_API_KEY = "sk_test_fake_key_for_unit_tests";

// Helper to generate signed webhook payloads
function createSignedWebhookPayload(
  payload: object,
  secret: string,
): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${body}`;
  const signature = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  return {
    body,
    signature: `t=${timestamp},v1=${signature}`,
  };
}

// Helper to create a mock Stripe subscription object
function createMockSubscription(
  overrides: Partial<{
    id: string;
    status: Stripe.Subscription.Status;
    cancel_at_period_end: boolean;
    current_period_end: number;
    metadata: Record<string, string>;
    productId: string;
  }> = {},
): object {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: overrides.id ?? "sub_test123",
    object: "subscription",
    status: overrides.status ?? "active",
    cancel_at_period_end: overrides.cancel_at_period_end ?? false,
    current_period_end: overrides.current_period_end ?? now + 30 * 24 * 60 * 60,
    customer: "cus_test123",
    metadata: overrides.metadata ?? { billing_sdk_customer_ref: "user_123" },
    items: {
      data: [
        {
          id: "si_test123",
          price: {
            id: "price_test123",
            product: overrides.productId ?? "prod_test123",
          },
        },
      ],
    },
  };
}

// Helper to create a mock Stripe event
function createMockEvent(
  type: string,
  data: object,
  previousAttributes?: object,
): object {
  return {
    id: `evt_test_${Date.now()}`,
    object: "event",
    type,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: data,
      previous_attributes: previousAttributes,
    },
  };
}

describe("stripe adapter", () => {
  let provider: StripeProvider;

  beforeEach(() => {
    provider = stripe({
      apiKey: TEST_API_KEY,
      webhookSecret: TEST_WEBHOOK_SECRET,
    });
  });

  describe("provider basics", () => {
    it("has correct name", () => {
      expect(provider.name).toBe("stripe");
    });

    it("reports capabilities truthfully", () => {
      expect(provider.capabilities).toEqual({
        webhookVerification: true,
        customerPortal: true,
        merchantOfRecord: false, // Stripe is not MoR
        usageBilling: true,
        proration: true,
        refunds: true,
      });
    });

    it("exposes native Stripe client", () => {
      expect(provider.native).toBeInstanceOf(Stripe);
    });
  });

  describe("webhook signature verification", () => {
    it("throws WebhookVerificationError on missing signature", async () => {
      await expect(
        provider.handleWebhook({
          body: JSON.stringify({ type: "test" }),
          headers: {},
          secret: TEST_WEBHOOK_SECRET,
        }),
      ).rejects.toThrow(WebhookVerificationError);
    });

    it("throws WebhookVerificationError on invalid signature", async () => {
      await expect(
        provider.handleWebhook({
          body: JSON.stringify({ type: "test" }),
          headers: { "stripe-signature": "t=123,v1=invalid" },
          secret: TEST_WEBHOOK_SECRET,
        }),
      ).rejects.toThrow(WebhookVerificationError);
    });

    it("accepts valid signature", async () => {
      const sub = createMockSubscription();
      const event = createMockEvent("customer.subscription.created", sub);
      const { body, signature } = createSignedWebhookPayload(
        event,
        TEST_WEBHOOK_SECRET,
      );

      const result = await provider.handleWebhook({
        body,
        headers: { "stripe-signature": signature },
        secret: TEST_WEBHOOK_SECRET,
      });

      expect(result.type).toBe("subscription.started");
    });
  });

  describe("subscription.created webhook", () => {
    it("maps to subscription.started event", async () => {
      const sub = createMockSubscription({
        metadata: { billing_sdk_customer_ref: "user_abc" },
      });
      const event = createMockEvent("customer.subscription.created", sub);
      const { body, signature } = createSignedWebhookPayload(
        event,
        TEST_WEBHOOK_SECRET,
      );

      const result = await provider.handleWebhook({
        body,
        headers: { "stripe-signature": signature },
        secret: TEST_WEBHOOK_SECRET,
      });

      expect(result.type).toBe("subscription.started");
      expect(result.customerRef).toBe("user_abc");
      if (result.type === "subscription.started") {
        expect(result.entitlement.active).toBe(true);
        expect(result.entitlement.status).toBe("active");
      }
    });
  });

  describe("subscription.updated webhook - cancellation scheduled", () => {
    it("maps to subscription.canceled when cancel_at_period_end becomes true", async () => {
      const sub = createMockSubscription({
        cancel_at_period_end: true,
        metadata: { billing_sdk_customer_ref: "user_cancel" },
      });
      const event = createMockEvent(
        "customer.subscription.updated",
        sub,
        { cancel_at_period_end: false }, // Was false, now true
      );
      const { body, signature } = createSignedWebhookPayload(
        event,
        TEST_WEBHOOK_SECRET,
      );

      const result = await provider.handleWebhook({
        body,
        headers: { "stripe-signature": signature },
        secret: TEST_WEBHOOK_SECRET,
      });

      expect(result.type).toBe("subscription.canceled");
      if (result.type === "subscription.canceled") {
        // CRITICAL: canceled means scheduled, user still has access
        expect(result.entitlement.active).toBe(true);
        expect(result.entitlement.status).toBe("canceled");
        expect(result.entitlement.cancelAtPeriodEnd).toBe(true);
      }
    });
  });

  describe("subscription.updated webhook - renewal", () => {
    it("maps to subscription.renewed when period extends", async () => {
      const now = Math.floor(Date.now() / 1000);
      const oldPeriodEnd = now + 10 * 24 * 60 * 60; // 10 days
      const newPeriodEnd = now + 40 * 24 * 60 * 60; // 40 days

      const sub = createMockSubscription({
        current_period_end: newPeriodEnd,
        metadata: { billing_sdk_customer_ref: "user_renew" },
      });
      const event = createMockEvent("customer.subscription.updated", sub, {
        current_period_end: oldPeriodEnd,
      });
      const { body, signature } = createSignedWebhookPayload(
        event,
        TEST_WEBHOOK_SECRET,
      );

      const result = await provider.handleWebhook({
        body,
        headers: { "stripe-signature": signature },
        secret: TEST_WEBHOOK_SECRET,
      });

      expect(result.type).toBe("subscription.renewed");
      if (result.type === "subscription.renewed") {
        expect(result.entitlement.active).toBe(true);
      }
    });
  });

  describe("subscription.deleted webhook", () => {
    it("maps to subscription.ended - access revoked", async () => {
      const sub = createMockSubscription({
        status: "canceled",
        metadata: { billing_sdk_customer_ref: "user_end" },
      });
      const event = createMockEvent("customer.subscription.deleted", sub);
      const { body, signature } = createSignedWebhookPayload(
        event,
        TEST_WEBHOOK_SECRET,
      );

      const result = await provider.handleWebhook({
        body,
        headers: { "stripe-signature": signature },
        secret: TEST_WEBHOOK_SECRET,
      });

      expect(result.type).toBe("subscription.ended");
      if (result.type === "subscription.ended") {
        // CRITICAL: ended means access is gone NOW
        expect(result.entitlement.active).toBe(false);
        expect(result.entitlement.status).toBe("expired");
      }
    });

    it("handles subscription that was cancel_at_period_end", async () => {
      // This tests the case where subscription was scheduled to cancel,
      // and now the period has ended, triggering deletion
      const sub = createMockSubscription({
        status: "canceled",
        cancel_at_period_end: true,
        metadata: { billing_sdk_customer_ref: "user_scheduled_end" },
      });
      const event = createMockEvent("customer.subscription.deleted", sub);
      const { body, signature } = createSignedWebhookPayload(
        event,
        TEST_WEBHOOK_SECRET,
      );

      const result = await provider.handleWebhook({
        body,
        headers: { "stripe-signature": signature },
        secret: TEST_WEBHOOK_SECRET,
      });

      // Even though it was scheduled, by the time we get deleted event,
      // access is gone
      expect(result.type).toBe("subscription.ended");
      if (result.type === "subscription.ended") {
        expect(result.entitlement.active).toBe(false);
      }
    });
  });

  describe("unmapped events", () => {
    it("returns unmapped for unknown event types", async () => {
      const event = createMockEvent("some.unknown.event", { foo: "bar" });
      const { body, signature } = createSignedWebhookPayload(
        event,
        TEST_WEBHOOK_SECRET,
      );

      const result = await provider.handleWebhook({
        body,
        headers: { "stripe-signature": signature },
        secret: TEST_WEBHOOK_SECRET,
      });

      expect(result.type).toBe("unmapped");
      if (result.type === "unmapped") {
        expect(result.providerType).toBe("some.unknown.event");
        expect(result.raw).toEqual({ foo: "bar" });
      }
    });

    it("returns unmapped for subscription.updated without meaningful changes", async () => {
      // An update that's not a cancellation or renewal
      const sub = createMockSubscription();
      const event = createMockEvent(
        "customer.subscription.updated",
        sub,
        { description: "old description" }, // Just a description change
      );
      const { body, signature } = createSignedWebhookPayload(
        event,
        TEST_WEBHOOK_SECRET,
      );

      const result = await provider.handleWebhook({
        body,
        headers: { "stripe-signature": signature },
        secret: TEST_WEBHOOK_SECRET,
      });

      expect(result.type).toBe("unmapped");
    });
  });

  describe("status mapping", () => {
    const statusTests: Array<{
      stripeStatus: Stripe.Subscription.Status;
      expectedStatus: string;
      expectedActive: boolean;
    }> = [
      {
        stripeStatus: "active",
        expectedStatus: "active",
        expectedActive: true,
      },
      {
        stripeStatus: "trialing",
        expectedStatus: "trialing",
        expectedActive: true,
      },
      {
        stripeStatus: "past_due",
        expectedStatus: "past_due",
        expectedActive: false,
      },
      {
        stripeStatus: "canceled",
        expectedStatus: "expired",
        expectedActive: false,
      },
      {
        stripeStatus: "incomplete",
        expectedStatus: "expired",
        expectedActive: false,
      },
      {
        stripeStatus: "incomplete_expired",
        expectedStatus: "expired",
        expectedActive: false,
      },
      {
        stripeStatus: "unpaid",
        expectedStatus: "expired",
        expectedActive: false,
      },
      {
        stripeStatus: "paused",
        expectedStatus: "expired",
        expectedActive: false,
      },
    ];

    for (const {
      stripeStatus,
      expectedStatus,
      expectedActive,
    } of statusTests) {
      it(`maps Stripe status "${stripeStatus}" to "${expectedStatus}" with active=${expectedActive}`, async () => {
        const sub = createMockSubscription({ status: stripeStatus });
        const event = createMockEvent("customer.subscription.created", sub);
        const { body, signature } = createSignedWebhookPayload(
          event,
          TEST_WEBHOOK_SECRET,
        );

        const result = await provider.handleWebhook({
          body,
          headers: { "stripe-signature": signature },
          secret: TEST_WEBHOOK_SECRET,
        });

        expect(result.type).toBe("subscription.started");
        if (result.type === "subscription.started") {
          expect(result.entitlement.status).toBe(expectedStatus);
          expect(result.entitlement.active).toBe(expectedActive);
        }
      });
    }
  });

  describe("customerRef extraction", () => {
    it("extracts customerRef from subscription metadata", async () => {
      const sub = createMockSubscription({
        metadata: { billing_sdk_customer_ref: "my_user_id_123" },
      });
      const event = createMockEvent("customer.subscription.created", sub);
      const { body, signature } = createSignedWebhookPayload(
        event,
        TEST_WEBHOOK_SECRET,
      );

      const result = await provider.handleWebhook({
        body,
        headers: { "stripe-signature": signature },
        secret: TEST_WEBHOOK_SECRET,
      });

      expect(result.customerRef).toBe("my_user_id_123");
    });

    it("returns null when customerRef is missing", async () => {
      const sub = createMockSubscription({ metadata: {} });
      const event = createMockEvent("customer.subscription.created", sub);
      const { body, signature } = createSignedWebhookPayload(
        event,
        TEST_WEBHOOK_SECRET,
      );

      const result = await provider.handleWebhook({
        body,
        headers: { "stripe-signature": signature },
        secret: TEST_WEBHOOK_SECRET,
      });

      expect(result.customerRef).toBeNull();
    });
  });
});

describe("canceled vs ended distinction (Stripe)", () => {
  let provider: StripeProvider;

  beforeEach(() => {
    provider = stripe({
      apiKey: TEST_API_KEY,
      webhookSecret: TEST_WEBHOOK_SECRET,
    });
  });

  it("subscription.updated with cancel_at_period_end=true → user STILL has access", async () => {
    const sub = createMockSubscription({
      status: "active", // Still active in Stripe
      cancel_at_period_end: true,
      metadata: { billing_sdk_customer_ref: "user_cancel_test" },
    });
    const event = createMockEvent("customer.subscription.updated", sub, {
      cancel_at_period_end: false,
    });
    const { body, signature } = createSignedWebhookPayload(
      event,
      TEST_WEBHOOK_SECRET,
    );

    const result = await provider.handleWebhook({
      body,
      headers: { "stripe-signature": signature },
      secret: TEST_WEBHOOK_SECRET,
    });

    expect(result.type).toBe("subscription.canceled");
    if (result.type === "subscription.canceled") {
      expect(result.entitlement.active).toBe(true);
      expect(result.entitlement.cancelAtPeriodEnd).toBe(true);
    }
  });

  it("subscription.deleted → user has NO access", async () => {
    const sub = createMockSubscription({
      status: "canceled",
      metadata: { billing_sdk_customer_ref: "user_delete_test" },
    });
    const event = createMockEvent("customer.subscription.deleted", sub);
    const { body, signature } = createSignedWebhookPayload(
      event,
      TEST_WEBHOOK_SECRET,
    );

    const result = await provider.handleWebhook({
      body,
      headers: { "stripe-signature": signature },
      secret: TEST_WEBHOOK_SECRET,
    });

    expect(result.type).toBe("subscription.ended");
    if (result.type === "subscription.ended") {
      expect(result.entitlement.active).toBe(false);
    }
  });
});

afterEach(() => vi.restoreAllMocks());

describe("Stripe provider regressions", () => {
  const makeProvider = () =>
    stripe({ apiKey: TEST_API_KEY, webhookSecret: TEST_WEBHOOK_SECRET });
  async function webhook(type: string, data: object, previous?: object) {
    const { body, signature } = createSignedWebhookPayload(
      createMockEvent(type, data, previous),
      TEST_WEBHOOK_SECRET,
    );
    return makeProvider().handleWebhook({
      body,
      headers: { "Stripe-Signature": signature },
      secret: TEST_WEBHOOK_SECRET,
    });
  }
  it("supports item-level billing periods in newer Stripe API versions", async () => {
    const end = Math.floor(Date.now() / 1000) + 1000;
    const sub = {
      ...createMockSubscription(),
      current_period_end: undefined,
      items: {
        data: [{ current_period_end: end, price: { product: "prod_new" } }],
      },
    };
    expect(await webhook("customer.subscription.created", sub)).toMatchObject({
      entitlement: { productId: "prod_new", periodEnd: new Date(end * 1000) },
    });
    expect(
      await webhook("customer.subscription.updated", sub, {
        items: { data: [{ current_period_end: end - 100 }] },
      }),
    ).toMatchObject({ type: "subscription.renewed" });
  });
  it("does not mistake unrelated changes for a newly scheduled cancellation", async () => {
    const event = await webhook(
      "customer.subscription.updated",
      createMockSubscription({ cancel_at_period_end: true }),
      { metadata: {} },
    );
    expect(event.type).toBe("unmapped");
    expect(event.customerRef).toBe("user_123");
  });
  it.each(["invoice.paid", "invoice.payment_failed"])(
    "extracts modern invoice attribution for %s",
    async (type) => {
      expect(
        await webhook(type, {
          amount_paid: 100,
          amount_due: 200,
          currency: "usd",
          parent: {
            subscription_details: {
              metadata: { billing_sdk_customer_ref: "user_123" },
            },
          },
        }),
      ).toMatchObject({
        customerRef: "user_123",
        amount: type === "invoice.paid" ? 100 : 200,
      });
    },
  );
  it("protects reserved checkout identity in both metadata locations", async () => {
    const provider = makeProvider();
    const create = vi
      .spyOn(provider.native.checkout.sessions, "create")
      .mockResolvedValue({
        id: "checkout",
        url: "https://checkout.stripe.com/test",
      } as never);
    await provider.createCheckout({
      priceId: "price_1",
      customerRef: "user_123",
      successUrl: "https://app.test",
      metadata: { billing_sdk_customer_ref: "forged", campaign: "launch" },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { billing_sdk_customer_ref: "user_123", campaign: "launch" },
        subscription_data: {
          metadata: {
            billing_sdk_customer_ref: "user_123",
            campaign: "launch",
          },
        },
      }),
    );
  });
  it("paginates search and prefers accessible subscriptions over canceled history", async () => {
    const provider = makeProvider();
    const search = vi
      .spyOn(provider.native.subscriptions, "search")
      .mockResolvedValueOnce({
        data: [createMockSubscription({ status: "canceled" })],
        has_more: true,
        next_page: "page_2",
      } as never)
      .mockResolvedValueOnce({
        data: [createMockSubscription({ productId: "prod_current" })],
        has_more: false,
      } as never);
    expect(await provider.getEntitlement("user_123")).toMatchObject({
      active: true,
      productId: "prod_current",
    });
    expect(search).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ page: "page_2", limit: 100 }),
    );
  });
  it("escapes customer references before embedding them in search syntax", async () => {
    const provider = makeProvider();
    const search = vi
      .spyOn(provider.native.subscriptions, "search")
      .mockResolvedValue({ data: [], has_more: false } as never);
    const ref = 'user" OR status:"active';
    await provider.getEntitlement(ref);
    expect(search.mock.calls[0]![0].query).toBe(
      'metadata["billing_sdk_customer_ref"]:"user\\" OR status:\\"active"',
    );
  });
  it("does not accept a search result attributed to a different user", async () => {
    const provider = makeProvider();
    vi.spyOn(provider.native.subscriptions, "search").mockResolvedValue({
      data: [
        createMockSubscription({
          metadata: { billing_sdk_customer_ref: "another_user" },
        }),
      ],
      has_more: false,
    } as never);
    expect(await provider.getEntitlement("user_123")).toBeNull();
  });
  it("supports direct customer mapping for immediate reads and checkout reuse", async () => {
    const provider = stripe({
      apiKey: TEST_API_KEY,
      webhookSecret: TEST_WEBHOOK_SECRET,
      resolveCustomerId: async () => "cus_mapped",
    });
    const list = vi
      .spyOn(provider.native.subscriptions, "list")
      .mockResolvedValue({
        data: [createMockSubscription()],
        has_more: false,
      } as never);
    const search = vi.spyOn(provider.native.subscriptions, "search");
    expect((await provider.getEntitlement("user_123"))?.active).toBe(true);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_mapped", status: "all" }),
    );
    expect(search).not.toHaveBeenCalled();
    const create = vi
      .spyOn(provider.native.checkout.sessions, "create")
      .mockResolvedValue({
        id: "checkout",
        url: "https://checkout.stripe.com/test",
      } as never);
    await provider.createCheckout({
      priceId: "price",
      customerRef: "user_123",
      email: "user@test.com",
      successUrl: "https://app.test",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_mapped",
        customer_email: undefined,
      }),
    );
  });
  it("opens a mapped customer's portal without requiring subscription history", async () => {
    const provider = stripe({
      apiKey: TEST_API_KEY,
      webhookSecret: TEST_WEBHOOK_SECRET,
      resolveCustomerId: async () => "cus_mapped",
    });
    const create = vi
      .spyOn(provider.native.billingPortal.sessions, "create")
      .mockResolvedValue({ url: "https://billing.stripe.com/test" } as never);
    await provider.createPortalSession!("user", "https://app.test");
    expect(create).toHaveBeenCalledWith({
      customer: "cus_mapped",
      return_url: "https://app.test",
    });
  });
  it("propagates API errors and rejects invalid refund inputs before sending", async () => {
    const provider = makeProvider();
    vi.spyOn(provider.native.subscriptions, "search").mockRejectedValue(
      new Error("429"),
    );
    await expect(provider.getEntitlement("user")).rejects.toThrow("429");
    const refund = vi.spyOn(provider.native.refunds, "create");
    await expect(provider.refund!("not_a_payment", 100)).rejects.toThrow(
      TypeError,
    );
    await expect(provider.refund!("pi_123", -1)).rejects.toThrow(RangeError);
    expect(refund).not.toHaveBeenCalled();
  });
});
