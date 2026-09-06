/**
 * Enhanced billing client with caching and feature gating.
 *
 * This wraps the base BillingProvider with:
 * - Entitlement caching (memory or Redis)
 * - Feature gating based on plan definitions
 * - Automatic cache invalidation on webhooks
 */

import type { BillingProvider, BillingEvent, Entitlement, WebhookRequest } from "./types.js";
import type { CacheAdapter, CacheOptions } from "./cache/types.js";
import type { PlanConfig, FeatureCheckResult } from "./features/types.js";
import { memoryCache } from "./cache/memory.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnhancedClientOptions {
  /**
   * The billing provider to wrap.
   */
  provider: BillingProvider;

  /**
   * Cache configuration.
   * Pass false to disable caching entirely.
   */
  cache?: CacheOptions | false;

  /**
   * Feature gating configuration.
   * Map of product IDs to their feature sets.
   */
  plans?: PlanConfig;

  /**
   * Default features for users without subscriptions.
   */
  defaultFeatures?: string[];
}

export interface EnhancedBillingClient {
  /** Provider name */
  readonly name: string;

  /** Provider capabilities */
  readonly capabilities: BillingProvider["capabilities"];

  /**
   * Get entitlement for a customer.
   * Uses cache if configured.
   */
  getEntitlement(customerRef: string): Promise<Entitlement | null>;

  /**
   * Handle webhook and auto-invalidate cache.
   */
  handleWebhook(req: WebhookRequest): Promise<BillingEvent>;

  /**
   * Create a checkout session.
   */
  createCheckout: BillingProvider["createCheckout"];

  /**
   * Create a customer portal session (if supported).
   */
  createPortalSession?: BillingProvider["createPortalSession"];

  /**
   * Issue a refund (if supported).
   */
  refund?: BillingProvider["refund"];

  /**
   * Check if customer has access to a specific feature.
   * Returns false if no subscription or feature not in plan.
   */
  hasFeature(customerRef: string, feature: string): Promise<boolean>;

  /**
   * Get all features available to a customer.
   */
  getFeatures(customerRef: string): Promise<string[]>;

  /**
   * Check feature access with detailed result.
   */
  checkFeature(customerRef: string, feature: string): Promise<FeatureCheckResult>;

  /**
   * Manually invalidate cache for a customer.
   */
  invalidateCache(customerRef: string): Promise<void>;

  /**
   * Invalidate all cached entitlements.
   */
  invalidateAllCache(): Promise<void>;

  /**
   * Access the underlying provider.
   */
  native<T>(): T;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 60_000; // 1 minute
const DEFAULT_NULL_TTL_MS = 10_000; // 10 seconds for "no subscription" results

/**
 * Creates an enhanced billing client with caching and feature gating.
 *
 * @example
 * ```ts
 * import { createEnhancedClient } from "@opencoredev/billing-sdk";
 * import { stripe } from "@opencoredev/billing-sdk/stripe";
 *
 * const billing = createEnhancedClient({
 *   provider: stripe({ ... }),
 *   cache: { ttlMs: 60_000 },
 *   plans: {
 *     "prod_free": { features: ["basic"] },
 *     "prod_pro": { features: ["basic", "advanced", "api"] },
 *     "prod_enterprise": { features: "*" },
 *   },
 *   defaultFeatures: ["basic"],
 * });
 *
 * // Check access
 * if (await billing.hasFeature("user_123", "api")) {
 *   // Allow API access
 * }
 * ```
 */
export function createEnhancedClient(options: EnhancedClientOptions): EnhancedBillingClient {
  const { provider, plans = {}, defaultFeatures = [] } = options;

  // Set up cache
  let cache: CacheAdapter | null = null;
  let ttlMs = DEFAULT_TTL_MS;
  let nullTtlMs = DEFAULT_NULL_TTL_MS;
  let cacheNulls = true;

  if (options.cache !== false) {
    const cacheOpts = options.cache ?? {};
    cache = cacheOpts.adapter ?? memoryCache();
    ttlMs = cacheOpts.ttlMs ?? DEFAULT_TTL_MS;
    nullTtlMs = cacheOpts.nullTtlMs ?? DEFAULT_NULL_TTL_MS;
    cacheNulls = cacheOpts.cacheNulls ?? true;
  }

  // Compute all features for "*" expansion
  const allFeatures = new Set<string>();
  for (const plan of Object.values(plans)) {
    if (Array.isArray(plan.features)) {
      plan.features.forEach((f) => allFeatures.add(f));
    }
  }
  defaultFeatures.forEach((f) => allFeatures.add(f));

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  async function getCachedEntitlement(customerRef: string): Promise<Entitlement | null> {
    if (!cache) {
      return provider.getEntitlement(customerRef);
    }

    // Check cache first
    const cached = await cache.get(customerRef);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - fetch from provider
    const entitlement = await provider.getEntitlement(customerRef);

    // Store in cache
    if (entitlement !== null) {
      await cache.set(customerRef, entitlement, ttlMs);
    } else if (cacheNulls) {
      await cache.set(customerRef, null, nullTtlMs);
    }

    return entitlement;
  }

  function getFeaturesForPlan(productId: string | undefined): string[] {
    if (!productId) {
      return [...defaultFeatures];
    }

    const plan = plans[productId];
    if (!plan) {
      // Unknown plan - return defaults
      return [...defaultFeatures];
    }

    if (plan.features === "*") {
      return [...allFeatures];
    }

    return [...plan.features];
  }

  // ---------------------------------------------------------------------------
  // Client implementation
  // ---------------------------------------------------------------------------

  const client: EnhancedBillingClient = {
    get name() {
      return provider.name;
    },

    get capabilities() {
      return provider.capabilities;
    },

    async getEntitlement(customerRef: string): Promise<Entitlement | null> {
      return getCachedEntitlement(customerRef);
    },

    async handleWebhook(req: WebhookRequest): Promise<BillingEvent> {
      const event = await provider.handleWebhook(req);

      // Auto-invalidate cache on subscription events
      if (cache && event.customerRef) {
        const invalidatingEvents = [
          "subscription.started",
          "subscription.renewed",
          "subscription.canceled",
          "subscription.ended",
        ];
        if (invalidatingEvents.includes(event.type)) {
          await cache.invalidate(event.customerRef);
        }
      }

      return event;
    },

    createCheckout: provider.createCheckout.bind(provider),

    ...(provider.createPortalSession && {
      createPortalSession: provider.createPortalSession.bind(provider),
    }),

    ...(provider.refund && {
      refund: provider.refund.bind(provider),
    }),

    async hasFeature(customerRef: string, feature: string): Promise<boolean> {
      const result = await client.checkFeature(customerRef, feature);
      return result.allowed;
    },

    async getFeatures(customerRef: string): Promise<string[]> {
      const entitlement = await getCachedEntitlement(customerRef);

      if (!entitlement || !entitlement.active) {
        return [...defaultFeatures];
      }

      return getFeaturesForPlan(entitlement.productId);
    },

    async checkFeature(customerRef: string, feature: string): Promise<FeatureCheckResult> {
      const entitlement = await getCachedEntitlement(customerRef);

      // No subscription
      if (!entitlement) {
        const allowed = defaultFeatures.includes(feature);
        return {
          allowed,
          reason: allowed ? "default" : "no_subscription",
        };
      }

      // Has subscription but not active
      if (!entitlement.active) {
        const allowed = defaultFeatures.includes(feature);
        return {
          allowed,
          reason: allowed ? "default" : "no_subscription",
          productId: entitlement.productId,
        };
      }

      // Active subscription - check plan
      const plan = plans[entitlement.productId];

      if (!plan) {
        // Unknown plan - grant defaults only
        const allowed = defaultFeatures.includes(feature);
        return {
          allowed,
          reason: allowed ? "default" : "unknown_plan",
          productId: entitlement.productId,
        };
      }

      // Check if feature is in plan
      if (plan.features === "*") {
        return {
          allowed: true,
          reason: "plan_feature",
          productId: entitlement.productId,
        };
      }

      const allowed = plan.features.includes(feature);
      return {
        allowed,
        reason: allowed ? "plan_feature" : "feature_not_in_plan",
        productId: entitlement.productId,
      };
    },

    async invalidateCache(customerRef: string): Promise<void> {
      if (cache) {
        await cache.invalidate(customerRef);
      }
    },

    async invalidateAllCache(): Promise<void> {
      if (cache) {
        await cache.invalidateAll();
      }
    },

    native<T>(): T {
      return provider.native as T;
    },
  };

  return client;
}
