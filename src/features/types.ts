/**
 * Feature gating types for billing-sdk
 *
 * Define what features each plan/product has access to,
 * then check access with simple method calls.
 */

/**
 * Definition of features available in a plan.
 */
export interface PlanDefinition {
  /**
   * List of feature keys this plan has access to.
   * Use "*" to indicate access to all features.
   */
  features: readonly string[] | "*";
  /** Nonnegative integer quotas. These do not enable metered billing. */
  limits?: Readonly<Record<string, number | "unlimited">>;
}

/**
 * Map of product IDs to their plan definitions.
 * Product IDs should match what your provider returns in entitlements.
 */
export type PlanConfig = Record<string, PlanDefinition>;

/**
 * Feature gating configuration options.
 */
export interface FeatureGatingOptions {
  /**
   * Map of product IDs to plan definitions.
   *
   * @example
   * ```ts
   * {
   *   "prod_free": { features: ["basic_export"] },
   *   "prod_pro": { features: ["basic_export", "api_access", "priority_support"] },
   *   "prod_enterprise": { features: "*" },
   * }
   * ```
   */
  plans: PlanConfig;

  /**
   * Default features for users without a subscription.
   * Default: [] (no features)
   */
  defaultFeatures?: readonly string[];

  /**
   * Whether to grant access when a plan ID is not found in config.
   * If true, unknown plans get defaultFeatures.
   * If false, unknown plans get no features.
   * Default: true (for backward compatibility)
   */
  allowUnknownPlans?: boolean;
}

/**
 * All defined features across all plans.
 * Computed from plan config for "*" expansion.
 */
export type FeatureSet = Set<string>;

/**
 * Result of feature access check.
 */
export interface FeatureCheckResult {
  /** Whether access is granted */
  allowed: boolean;
  /** Reason for the decision */
  reason:
    | "entitled"
    | "plan_feature"
    | "default"
    | "no_subscription"
    | "unknown_plan"
    | "feature_not_in_plan";
  /** The plan/product that was checked (if any) */
  productId?: string;
}

export interface LimitCheckResult {
  allowed: boolean;
  reason: "within_limit" | "limit_exceeded" | "no_limit_defined";
  limit: number | "unlimited" | null;
  /** Capacity before the requested operation; null for unlimited or undefined. */
  remaining: number | null;
}
