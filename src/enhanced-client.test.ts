/**
 * Enhanced client tests - cache + feature gating
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createEnhancedClient } from "./enhanced-client.js";
import { mock, type MockProvider } from "./adapters/mock.js";

describe("createEnhancedClient", () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = mock({ webhookSecret: "test_secret" });
  });

  describe("basic functionality", () => {
    it("passes through provider name and capabilities", () => {
      const client = createEnhancedClient({ provider });
      expect(client.name).toBe("mock");
      expect(client.capabilities).toEqual(provider.capabilities);
    });

    it("provides native() escape hatch", () => {
      const client = createEnhancedClient({ provider });
      expect(client.native()).toBeDefined();
    });
  });

  describe("caching", () => {
    it("caches entitlement on first fetch", async () => {
      provider._testing.createSubscription({
        customerRef: "user_123",
        productId: "prod_pro",
        status: "active",
      });

      const client = createEnhancedClient({ provider });

      // First call - hits provider
      const entitlement1 = await client.getEntitlement("user_123");
      expect(entitlement1?.active).toBe(true);

      // Second call - should hit cache (provider state unchanged)
      const entitlement2 = await client.getEntitlement("user_123");
      expect(entitlement2).toEqual(entitlement1);
    });

    it("respects cache: false option", async () => {
      provider._testing.createSubscription({
        customerRef: "user_123",
        productId: "prod_pro",
        status: "active",
      });

      const client = createEnhancedClient({ provider, cache: false });

      // Both calls should hit provider directly
      const entitlement1 = await client.getEntitlement("user_123");
      const entitlement2 = await client.getEntitlement("user_123");

      expect(entitlement1?.active).toBe(true);
      expect(entitlement2?.active).toBe(true);
    });

    it("invalidates cache on webhook events", async () => {
      const sub = provider._testing.createSubscription({
        customerRef: "user_123",
        productId: "prod_pro",
        status: "active",
      });

      const client = createEnhancedClient({ provider });

      // Warm the cache
      await client.getEntitlement("user_123");

      // Cancel subscription and handle webhook
      await provider._testing.cancelSubscription(sub.id);
      const webhookReq = await provider._testing.createWebhookRequest({
        type: "subscription.canceled",
        subscriptionId: sub.id,
      });

      await client.handleWebhook(webhookReq);

      // Next fetch should get updated data (cache was invalidated)
      const entitlement = await client.getEntitlement("user_123");
      expect(entitlement?.status).toBe("canceled");
    });

    it("supports manual cache invalidation", async () => {
      provider._testing.createSubscription({
        customerRef: "user_123",
        productId: "prod_pro",
        status: "active",
      });

      const client = createEnhancedClient({ provider });

      await client.getEntitlement("user_123");
      await client.invalidateCache("user_123");

      // Should fetch fresh from provider
      const entitlement = await client.getEntitlement("user_123");
      expect(entitlement?.active).toBe(true);
    });

    it("supports invalidating all cache", async () => {
      provider._testing.createSubscription({
        customerRef: "user_1",
        productId: "prod_pro",
        status: "active",
      });
      provider._testing.createSubscription({
        customerRef: "user_2",
        productId: "prod_pro",
        status: "active",
      });

      const client = createEnhancedClient({ provider });

      await client.getEntitlement("user_1");
      await client.getEntitlement("user_2");
      await client.invalidateAllCache();

      // Both should fetch fresh
      const e1 = await client.getEntitlement("user_1");
      const e2 = await client.getEntitlement("user_2");
      expect(e1?.active).toBe(true);
      expect(e2?.active).toBe(true);
    });
  });

  describe("feature gating", () => {
    const plans = {
      prod_free: { features: ["basic_export"] },
      prod_pro: { features: ["basic_export", "api_access", "priority_support"] },
      prod_enterprise: { features: "*" as const },
    };

    it("returns default features for users without subscription", async () => {
      const client = createEnhancedClient({
        provider,
        plans,
        defaultFeatures: ["basic_export"],
      });

      const features = await client.getFeatures("nonexistent_user");
      expect(features).toEqual(["basic_export"]);
    });

    it("hasFeature returns true for default features without subscription", async () => {
      const client = createEnhancedClient({
        provider,
        plans,
        defaultFeatures: ["basic_export"],
      });

      const hasBasic = await client.hasFeature("nonexistent_user", "basic_export");
      const hasApi = await client.hasFeature("nonexistent_user", "api_access");

      expect(hasBasic).toBe(true);
      expect(hasApi).toBe(false);
    });

    it("returns plan features for active subscribers", async () => {
      provider._testing.createSubscription({
        customerRef: "user_pro",
        productId: "prod_pro",
        status: "active",
      });

      const client = createEnhancedClient({ provider, plans });
      const features = await client.getFeatures("user_pro");

      expect(features).toContain("basic_export");
      expect(features).toContain("api_access");
      expect(features).toContain("priority_support");
    });

    it("hasFeature checks plan features", async () => {
      provider._testing.createSubscription({
        customerRef: "user_pro",
        productId: "prod_pro",
        status: "active",
      });

      const client = createEnhancedClient({ provider, plans });

      expect(await client.hasFeature("user_pro", "api_access")).toBe(true);
      expect(await client.hasFeature("user_pro", "enterprise_only")).toBe(false);
    });

    it("wildcard (*) plan grants all defined features", async () => {
      provider._testing.createSubscription({
        customerRef: "user_enterprise",
        productId: "prod_enterprise",
        status: "active",
      });

      const client = createEnhancedClient({
        provider,
        plans,
        defaultFeatures: ["basic_export"],
      });

      // Enterprise gets everything defined anywhere
      expect(await client.hasFeature("user_enterprise", "basic_export")).toBe(true);
      expect(await client.hasFeature("user_enterprise", "api_access")).toBe(true);
      expect(await client.hasFeature("user_enterprise", "priority_support")).toBe(true);
    });

    it("checkFeature provides detailed result", async () => {
      provider._testing.createSubscription({
        customerRef: "user_pro",
        productId: "prod_pro",
        status: "active",
      });

      const client = createEnhancedClient({ provider, plans });

      const allowed = await client.checkFeature("user_pro", "api_access");
      expect(allowed).toEqual({
        allowed: true,
        reason: "plan_feature",
        productId: "prod_pro",
      });

      const denied = await client.checkFeature("user_pro", "enterprise_only");
      expect(denied).toEqual({
        allowed: false,
        reason: "feature_not_in_plan",
        productId: "prod_pro",
      });
    });

    it("returns default features for inactive subscriptions", async () => {
      provider._testing.createSubscription({
        customerRef: "user_expired",
        productId: "prod_pro",
        status: "expired",
      });

      const client = createEnhancedClient({
        provider,
        plans,
        defaultFeatures: ["basic_export"],
      });

      const features = await client.getFeatures("user_expired");
      expect(features).toEqual(["basic_export"]);

      // Should not have pro features
      expect(await client.hasFeature("user_expired", "api_access")).toBe(false);
    });

    it("handles unknown plan gracefully", async () => {
      provider._testing.createSubscription({
        customerRef: "user_legacy",
        productId: "prod_legacy_unknown",
        status: "active",
      });

      const client = createEnhancedClient({
        provider,
        plans,
        defaultFeatures: ["basic_export"],
      });

      // Unknown plan gets defaults only
      const features = await client.getFeatures("user_legacy");
      expect(features).toEqual(["basic_export"]);

      const check = await client.checkFeature("user_legacy", "api_access");
      expect(check.reason).toBe("unknown_plan");
    });

    it("canceled subscription still has features until period end", async () => {
      provider._testing.createSubscription({
        customerRef: "user_canceling",
        productId: "prod_pro",
        status: "canceled", // canceled but still active until period end
      });

      const client = createEnhancedClient({ provider, plans });

      // Canceled subscriptions are still "active" in our model
      const entitlement = await client.getEntitlement("user_canceling");
      expect(entitlement?.active).toBe(true);

      // So they should still have features
      expect(await client.hasFeature("user_canceling", "api_access")).toBe(true);
    });
  });

  describe("cache + features integration", () => {
    it("feature checks use cached entitlements", async () => {
      provider._testing.createSubscription({
        customerRef: "user_123",
        productId: "prod_pro",
        status: "active",
      });

      const client = createEnhancedClient({
        provider,
        plans: {
          prod_pro: { features: ["api_access"] },
        },
      });

      // First feature check warms cache
      await client.hasFeature("user_123", "api_access");

      // Subsequent checks use cache
      const result1 = await client.hasFeature("user_123", "api_access");
      const result2 = await client.getFeatures("user_123");

      expect(result1).toBe(true);
      expect(result2).toContain("api_access");
    });
  });
});

describe("feature gating edge cases", () => {
  it("empty defaultFeatures means no access without subscription", async () => {
    const provider = mock({ webhookSecret: "test" });
    const client = createEnhancedClient({
      provider,
      plans: {
        prod_pro: { features: ["api_access"] },
      },
      // No defaultFeatures specified
    });

    const features = await client.getFeatures("no_sub_user");
    expect(features).toEqual([]);
  });

  it("empty plans config means all subscriptions get defaults", async () => {
    const provider = mock({ webhookSecret: "test" });
    provider._testing.createSubscription({
      customerRef: "user_123",
      productId: "prod_mystery",
      status: "active",
    });

    const client = createEnhancedClient({
      provider,
      plans: {}, // No plans defined
      defaultFeatures: ["basic"],
    });

    const features = await client.getFeatures("user_123");
    expect(features).toEqual(["basic"]);
  });
});
