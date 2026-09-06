export { createBillingClient } from "./client.js";
export { createEnhancedClient, type EnhancedBillingClient, type EnhancedClientOptions } from "./enhanced-client.js";

export type {
  BillingClient,
  BillingEvent,
  BillingProvider,
  Capabilities,
  Checkout,
  CheckoutRequest,
  CreateBillingClientOptions,
  Entitlement,
  EntitlementStatus,
  WebhookRequest,
} from "./types.js";

export { WebhookVerificationError } from "./types.js";

// Re-export cache types for convenience
export type { CacheAdapter, CacheOptions, CacheStats } from "./cache/types.js";

// Re-export feature types for convenience
export type { PlanConfig, PlanDefinition, FeatureCheckResult } from "./features/types.js";
