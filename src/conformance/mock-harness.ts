/**
 * Conformance test harness for the mock adapter.
 */

import type { WebhookRequest } from "../types.js";
import type { MockProvider } from "../adapters/mock.js";
import type { ConformanceTestHarness } from "./index.js";

export function createMockHarness(provider: MockProvider): ConformanceTestHarness {
  return {
    async createSubscription(opts) {
      // Use the checkout flow to create a subscription
      const checkout = await provider.createCheckout({
        priceId: opts.priceId,
        customerRef: opts.customerRef,
        successUrl: "https://example.com/success",
      });

      const sub = await provider._testing.completeCheckout(checkout.id, {
        productId: opts.productId,
      });

      return { subscriptionId: sub.id };
    },

    async createWebhookRequest(opts): Promise<WebhookRequest> {
      if (opts.type === "unknown") {
        // Generate a webhook with an unknown event type
        return provider._testing.createWebhookRequest({
          type: "some.unknown.provider.event",
          subscriptionId: opts.subscriptionId,
        });
      }

      // Map our test types to mock webhook types
      const typeMap: Record<string, string> = {
        "subscription.created": "subscription.created",
        "subscription.canceled": "subscription.canceled",
        "subscription.ended": "subscription.ended",
      };

      return provider._testing.createWebhookRequest({
        type: typeMap[opts.type] || opts.type,
        subscriptionId: opts.subscriptionId,
      });
    },

    async createInvalidWebhookRequest(): Promise<WebhookRequest> {
      return {
        body: JSON.stringify({ type: "test.event" }),
        headers: { "x-mock-signature": "invalid_signature_abc123" },
        secret: provider.native.webhookSecret,
      };
    },

    async cancelSubscription(subscriptionId) {
      await provider._testing.cancelSubscription(subscriptionId);
    },

    async endSubscription(subscriptionId) {
      await provider._testing.endSubscription(subscriptionId);
    },

    async cleanup() {
      provider._testing.reset();
    },
  };
}
