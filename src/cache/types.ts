/**
 * Cache layer types for billing-sdk
 *
 * The cache stores entitlements to avoid hitting the provider API on every request.
 * Webhooks automatically invalidate the cache when subscription state changes.
 */

import type { Entitlement } from "../types.js";

/**
 * Cache adapter interface.
 *
 * Implement this to use your own caching backend (Redis, Memcached, etc.)
 */
export type CacheLookup =
  | { hit: false }
  | { hit: true; value: Entitlement | null };

export interface CacheAdapter {
  /** Distinguishes a cached null from a miss. Optional for legacy adapters. */
  lookup?(customerRef: string): Promise<CacheLookup>;
  /** Release owned resources, if any. */
  dispose?(): void | Promise<void>;
  /**
   * Get a cached entitlement by customerRef.
   * Returns null if not in cache or expired.
   */
  get(customerRef: string): Promise<Entitlement | null>;

  /**
   * Store an entitlement in the cache.
   * @param customerRef - The customer reference key
   * @param entitlement - The entitlement to cache (null means "no subscription")
   * @param ttlMs - Time to live in milliseconds
   */
  set(
    customerRef: string,
    entitlement: Entitlement | null,
    ttlMs: number,
  ): Promise<void>;

  /**
   * Invalidate (delete) a cached entitlement.
   * Called automatically when webhooks indicate state changes.
   */
  invalidate(customerRef: string): Promise<void>;

  /**
   * Invalidate all cached entitlements.
   * Useful for deployments or manual cache clearing.
   */
  invalidateAll(): Promise<void>;
}

/**
 * Cache configuration options.
 */
export interface CacheOptions {
  /** Key namespace; defaults to provider.name. Use an account-specific value when sharing a cache. */
  namespace?: string;
  /**
   * The cache adapter to use.
   * Defaults to in-memory cache if not specified.
   */
  adapter?: CacheAdapter;

  /**
   * Default TTL in milliseconds.
   * How long to cache entitlements before re-fetching from provider.
   * Default: 60000 (1 minute)
   */
  ttlMs?: number;

  /**
   * Whether to cache "no subscription" results.
   * If true, customers without subscriptions are cached to avoid repeated lookups.
   * Default: true
   */
  cacheNulls?: boolean;

  /**
   * TTL for null (no subscription) results in milliseconds.
   * Often shorter than regular TTL since you want to detect new subscriptions quickly.
   * Default: 10000 (10 seconds)
   */
  nullTtlMs?: number;
}

/**
 * Cache statistics for monitoring.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  invalidations: number;
  size: number;
}

/**
 * Extended cache adapter with optional stats support.
 */
export interface CacheAdapterWithStats extends CacheAdapter {
  /**
   * Get cache statistics.
   * Optional - not all adapters support this.
   */
  getStats?(): CacheStats;

  /**
   * Reset statistics.
   */
  resetStats?(): void;
}
