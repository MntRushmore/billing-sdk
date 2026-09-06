/**
 * In-memory cache adapter for billing-sdk
 *
 * Simple Map-based cache with TTL support.
 * Good for single-server deployments or development.
 * For multi-server deployments, use Redis adapter.
 */

import type { Entitlement } from "../types.js";
import type { CacheAdapterWithStats, CacheStats } from "./types.js";

interface CacheEntry {
  entitlement: Entitlement | null;
  expiresAt: number;
}

export interface MemoryCacheOptions {
  /**
   * Maximum number of entries to store.
   * When exceeded, oldest entries are evicted.
   * Default: 10000
   */
  maxSize?: number;

  /**
   * How often to run cleanup of expired entries (ms).
   * Default: 60000 (1 minute)
   */
  cleanupIntervalMs?: number;
}

/**
 * Creates an in-memory cache adapter.
 *
 * @example
 * ```ts
 * import { memoryCache } from "@opencoredev/billing-sdk/cache/memory";
 *
 * const cache = memoryCache({ maxSize: 5000 });
 * ```
 */
export function memoryCache(options: MemoryCacheOptions = {}): CacheAdapterWithStats {
  const maxSize = options.maxSize ?? 10000;
  const cleanupIntervalMs = options.cleanupIntervalMs ?? 60000;

  const cache = new Map<string, CacheEntry>();
  let stats: CacheStats = { hits: 0, misses: 0, invalidations: 0, size: 0 };

  // Periodic cleanup of expired entries
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  function startCleanup(): void {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) {
          cache.delete(key);
        }
      }
      stats.size = cache.size;
    }, cleanupIntervalMs);

    // Don't keep process alive just for cleanup
    if (cleanupTimer.unref) {
      cleanupTimer.unref();
    }
  }

  function evictOldest(): void {
    // Simple LRU-ish: delete first entry (oldest insertion)
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }

  startCleanup();

  return {
    async get(customerRef: string): Promise<Entitlement | null> {
      const entry = cache.get(customerRef);

      if (!entry) {
        stats.misses++;
        return null;
      }

      if (entry.expiresAt <= Date.now()) {
        cache.delete(customerRef);
        stats.misses++;
        stats.size = cache.size;
        return null;
      }

      stats.hits++;
      return entry.entitlement;
    },

    async set(customerRef: string, entitlement: Entitlement | null, ttlMs: number): Promise<void> {
      // Evict if at capacity
      if (cache.size >= maxSize && !cache.has(customerRef)) {
        evictOldest();
      }

      cache.set(customerRef, {
        entitlement,
        expiresAt: Date.now() + ttlMs,
      });
      stats.size = cache.size;
    },

    async invalidate(customerRef: string): Promise<void> {
      const deleted = cache.delete(customerRef);
      if (deleted) {
        stats.invalidations++;
        stats.size = cache.size;
      }
    },

    async invalidateAll(): Promise<void> {
      const count = cache.size;
      cache.clear();
      stats.invalidations += count;
      stats.size = 0;
    },

    getStats(): CacheStats {
      return { ...stats };
    },

    resetStats(): void {
      stats = { hits: 0, misses: 0, invalidations: 0, size: cache.size };
    },
  };
}
