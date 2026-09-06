/**
 * Redis cache adapter for billing-sdk
 *
 * Works with any Redis client that implements the minimal interface.
 * Compatible with ioredis, node-redis, and similar libraries.
 */

import type { Entitlement } from "../types.js";
import type { CacheAdapter } from "./types.js";

/**
 * Minimal Redis client interface.
 * Works with ioredis, node-redis, and most Redis clients.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

export interface RedisCacheOptions {
  /**
   * Redis client instance.
   * Must implement get, set, del, and keys methods.
   */
  client: RedisClient;

  /**
   * Key prefix for all cache entries.
   * Useful for namespacing in shared Redis instances.
   * Default: "billing:"
   */
  prefix?: string;
}

/**
 * Creates a Redis cache adapter.
 *
 * @example
 * ```ts
 * import { redisCache } from "@opencoredev/billing-sdk/cache/redis";
 * import Redis from "ioredis";
 *
 * const redis = new Redis(process.env.REDIS_URL);
 * const cache = redisCache({ client: redis });
 * ```
 *
 * @example
 * ```ts
 * // With node-redis
 * import { createClient } from "redis";
 * import { redisCache } from "@opencoredev/billing-sdk/cache/redis";
 *
 * const redis = createClient({ url: process.env.REDIS_URL });
 * await redis.connect();
 * const cache = redisCache({ client: redis });
 * ```
 */
export function redisCache(options: RedisCacheOptions): CacheAdapter {
  const { client } = options;
  const prefix = options.prefix ?? "billing:";

  function key(customerRef: string): string {
    return `${prefix}entitlement:${customerRef}`;
  }

  return {
    async get(customerRef: string): Promise<Entitlement | null> {
      const data = await client.get(key(customerRef));

      if (data === null) {
        return null;
      }

      try {
        const parsed = JSON.parse(data) as { entitlement: Entitlement | null };
        return parsed.entitlement;
      } catch {
        // Corrupted data, treat as miss
        return null;
      }
    },

    async set(customerRef: string, entitlement: Entitlement | null, ttlMs: number): Promise<void> {
      const data = JSON.stringify({
        entitlement,
        cachedAt: Date.now(),
      });

      // Use PX for millisecond precision TTL
      await client.set(key(customerRef), data, "PX", ttlMs);
    },

    async invalidate(customerRef: string): Promise<void> {
      await client.del(key(customerRef));
    },

    async invalidateAll(): Promise<void> {
      // Find all keys with our prefix and delete them
      const keys = await client.keys(`${prefix}entitlement:*`);
      if (keys.length > 0) {
        await client.del(keys);
      }
    },
  };
}
