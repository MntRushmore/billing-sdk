/**
 * Cache module for billing-sdk
 *
 * Provides caching layer to avoid hitting provider APIs on every request.
 * Automatically invalidates when webhooks indicate state changes.
 */

export type {
  CacheAdapter,
  CacheLookup,
  CacheAdapterWithStats,
  CacheOptions,
  CacheStats,
} from "./types.js";

export { memoryCache, type MemoryCacheOptions } from "./memory.js";
export {
  redisCache,
  type RedisCacheOptions,
  type RedisClient,
} from "./redis.js";
