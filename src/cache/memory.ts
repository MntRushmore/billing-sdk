import type { Entitlement } from "../types.js";
import type {
  CacheAdapterWithStats,
  CacheLookup,
  CacheStats,
} from "./types.js";

export interface MemoryCacheOptions {
  /** Maximum entries, evicted in least-recently-used order. Default: 10000. */
  maxSize?: number;
  /** Cleanup interval in milliseconds. Set 0 to disable. Default: 60000. */
  cleanupIntervalMs?: number;
}

export function memoryCache(
  options: MemoryCacheOptions = {},
): CacheAdapterWithStats {
  const maxSize = options.maxSize ?? 10000;
  const interval = options.cleanupIntervalMs ?? 60000;
  if (!Number.isSafeInteger(maxSize) || maxSize < 1)
    throw new RangeError("maxSize must be a positive integer");
  if (!Number.isFinite(interval) || interval < 0)
    throw new RangeError("cleanupIntervalMs must be nonnegative and finite");
  const entries = new Map<
    string,
    { entitlement: Entitlement | null; expiresAt: number }
  >();
  let stats = { hits: 0, misses: 0, invalidations: 0 };
  const timer =
    interval > 0
      ? setInterval(() => {
          for (const [key, entry] of entries) {
            if (entry.expiresAt <= Date.now()) entries.delete(key);
          }
        }, interval)
      : undefined;
  timer?.unref?.();

  async function lookup(customerRef: string): Promise<CacheLookup> {
    const entry = entries.get(customerRef);
    if (!entry || entry.expiresAt <= Date.now()) {
      entries.delete(customerRef);
      stats.misses++;
      return { hit: false };
    }
    entries.delete(customerRef);
    entries.set(customerRef, entry);
    stats.hits++;
    return { hit: true, value: structuredClone(entry.entitlement) };
  }

  return {
    lookup,
    async get(customerRef) {
      const result = await lookup(customerRef);
      return result.hit ? result.value : null;
    },
    async set(customerRef, entitlement, ttlMs) {
      if (!Number.isFinite(ttlMs) || ttlMs < 0)
        throw new RangeError("ttlMs must be nonnegative and finite");
      entries.delete(customerRef);
      if (ttlMs === 0) return;
      if (entries.size >= maxSize) entries.delete(entries.keys().next().value!);
      entries.set(customerRef, {
        entitlement: structuredClone(entitlement),
        expiresAt: Date.now() + ttlMs,
      });
    },
    async invalidate(customerRef) {
      if (entries.delete(customerRef)) stats.invalidations++;
    },
    async invalidateAll() {
      stats.invalidations += entries.size;
      entries.clear();
    },
    getStats(): CacheStats {
      return { ...stats, size: entries.size };
    },
    resetStats() {
      stats = { hits: 0, misses: 0, invalidations: 0 };
    },
    dispose() {
      clearInterval(timer);
      entries.clear();
    },
  };
}
