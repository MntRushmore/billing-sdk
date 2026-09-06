/**
 * Feature gating module for billing-sdk
 */

export type {
  PlanDefinition,
  PlanConfig,
  FeatureGatingOptions,
  FeatureSet,
  FeatureCheckResult,
} from "./types.js";

import type { PlanConfig, FeatureCheckResult } from "./types.js";
export type { LimitCheckResult } from "./types.js";

/** Validate a plan catalog while preserving literal product/feature types. */
export function definePlans<const T extends PlanConfig>(plans: T): T {
  for (const [id, plan] of Object.entries(plans)) {
    if (
      !plan ||
      (plan.features !== "*" &&
        (!Array.isArray(plan.features) ||
          plan.features.some(
            (feature) => typeof feature !== "string" || !feature.trim(),
          )))
    ) {
      throw new TypeError(`Invalid features for plan ${id}`);
    }
    for (const [name, limit] of Object.entries(plan.limits ?? {})) {
      if (
        limit !== "unlimited" &&
        (!Number.isSafeInteger(limit) || limit < 0)
      ) {
        throw new RangeError(`Invalid limit ${name} for plan ${id}`);
      }
    }
  }
  return plans;
}

export class FeatureAccessError extends Error {
  constructor(
    public readonly customerRef: string,
    public readonly feature: string,
    public readonly result: FeatureCheckResult,
  ) {
    super(`Access denied to feature "${feature}": ${result.reason}`);
    this.name = "FeatureAccessError";
  }
}
