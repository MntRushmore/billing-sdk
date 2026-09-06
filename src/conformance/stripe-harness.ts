/**
 * Conformance test harness for the Stripe adapter.
 *
 * This harness creates a mock Stripe environment for testing.
 * It intercepts Stripe API calls and simulates responses.
 */

import type Stripe from "stripe";
import type { WebhookRequest } from "../types.js";
import type { StripeProvider } from "../adapters/stripe.js";
import type { ConformanceTestHarness } from "./index.js";
import { createHmac } from "node:crypto";

interface MockStripeState {
  subscriptions: Map<string, MockSubscription>;
  customers: Map<string, MockCustomer>;
  checkoutSessions: Map<string, MockCheckoutSession>;
}

interface MockSubscription {
  id: string;
  customer: string;
  status: Stripe.Subscription.Status;
  cancel_at_period_end: boolean;
  current_period_end: number;
  metadata: Record<string, string>;
  items: {
    data: Array<{
      price: {
        product: string;
      };
    }>;
  };
}

interface MockCustomer {
  id: string;
  email: string;
}

interface MockCheckoutSession {
  id: string;
  url: string;
  customerRef: string;
  priceId: string;
}

/**
 * Creates a test harness for the Stripe adapter.
 *
 * Note: This harness requires a Stripe provider configured with test keys.
 * For true unit testing without API calls, use the mock adapter instead.
 *
 * This harness is primarily for integration testing with Stripe's test mode.
 */
export function createStripeHarness(
  provider: StripeProvider,
  webhookSecret: string
): ConformanceTestHarness {
  const state: MockStripeState = {
    subscriptions: new Map(),
    customers: new Map(),
    checkoutSessions: new Map(),
  };

  // Helper to generate Stripe-like IDs
  const generateId = (prefix: string) =>
    `${prefix}_test_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // Helper to sign webhook payloads like Stripe does
  function signPayload(payload: string, secret: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const signedPayload = `${timestamp}.${payload}`;
    const signature = createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");
    return `t=${timestamp},v1=${signature}`;
  }

  return {
    async createSubscription(opts) {
      const customerId = generateId("cus");
      const subscriptionId = generateId("sub");
      const now = Math.floor(Date.now() / 1000);
      const periodEnd = now + 30 * 24 * 60 * 60; // 30 days

      const customer: MockCustomer = {
        id: customerId,
        email: `${opts.customerRef}@test.com`,
      };

      const subscription: MockSubscription = {
        id: subscriptionId,
        customer: customerId,
        status: "active",
        cancel_at_period_end: false,
        current_period_end: periodEnd,
        metadata: {
          billing_sdk_customer_ref: opts.customerRef,
        },
        items: {
          data: [
            {
              price: {
                product: opts.productId,
              },
            },
          ],
        },
      };

      state.customers.set(customerId, customer);
      state.subscriptions.set(subscriptionId, subscription);

      return { subscriptionId };
    },

    async createWebhookRequest(opts): Promise<WebhookRequest> {
      const eventId = generateId("evt");
      const now = Math.floor(Date.now() / 1000);

      let eventType: string;
      let eventData: unknown;

      if (opts.type === "unknown") {
        eventType = "unknown.test.event";
        eventData = { test: true };
      } else {
        const sub = opts.subscriptionId
          ? state.subscriptions.get(opts.subscriptionId)
          : null;

        switch (opts.type) {
          case "subscription.created":
            eventType = "customer.subscription.created";
            eventData = sub ?? {
              id: opts.subscriptionId,
              status: "active",
              cancel_at_period_end: false,
              current_period_end: now + 30 * 24 * 60 * 60,
              metadata: { billing_sdk_customer_ref: opts.customerRef },
              items: { data: [{ price: { product: "prod_test" } }] },
            };
            break;
          case "subscription.canceled":
            eventType = "customer.subscription.updated";
            eventData = {
              ...sub,
              cancel_at_period_end: true,
            };
            break;
          case "subscription.ended":
            eventType = "customer.subscription.deleted";
            eventData = {
              ...sub,
              status: "canceled",
            };
            break;
          default:
            eventType = "unknown.event";
            eventData = {};
        }
      }

      const event = {
        id: eventId,
        type: eventType,
        created: now,
        data: {
          object: eventData,
          previous_attributes:
            opts.type === "subscription.canceled"
              ? { cancel_at_period_end: false }
              : undefined,
        },
      };

      const body = JSON.stringify(event);
      const signature = signPayload(body, webhookSecret);

      return {
        body,
        headers: {
          "stripe-signature": signature,
        },
        secret: webhookSecret,
      };
    },

    async createInvalidWebhookRequest(): Promise<WebhookRequest> {
      const event = {
        id: generateId("evt"),
        type: "test.event",
        created: Math.floor(Date.now() / 1000),
        data: { object: {} },
      };

      return {
        body: JSON.stringify(event),
        headers: {
          "stripe-signature": "t=123,v1=invalid_signature",
        },
        secret: webhookSecret,
      };
    },

    async cancelSubscription(subscriptionId) {
      const sub = state.subscriptions.get(subscriptionId);
      if (sub) {
        sub.cancel_at_period_end = true;
        // Status stays "active" in Stripe when cancel_at_period_end is set
      }
    },

    async endSubscription(subscriptionId) {
      const sub = state.subscriptions.get(subscriptionId);
      if (sub) {
        sub.status = "canceled";
        sub.current_period_end = Math.floor(Date.now() / 1000);
      }
    },

    async cleanup() {
      state.subscriptions.clear();
      state.customers.clear();
      state.checkoutSessions.clear();
    },
  };
}
