import type { Entitlement } from "../types.js";
import type { CacheAdapter, CacheLookup } from "./types.js";

/** ioredis-style command interface. Wrap other clients explicitly (see README). */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    expiryMode: "PX",
    ttlMs: number,
  ): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  scan(
    cursor: string,
    match: "MATCH",
    pattern: string,
    count: "COUNT",
    size: number,
  ): Promise<[string, string[]]>;
}

export interface RedisCacheOptions {
  client: RedisClient;
  /** Use a distinct prefix per application, environment, and provider account. */
  prefix?: string;
}

function deserialize(data: string): CacheLookup {
  try {
    const { entitlement: value } = JSON.parse(data);
    if (value === null) return { hit: true, value: null };
    if (
      !value ||
      typeof value.active !== "boolean" ||
      typeof value.productId !== "string" ||
      typeof value.customerRef !== "string" ||
      typeof value.provider !== "string" ||
      typeof value.cancelAtPeriodEnd !== "boolean" ||
      !["trialing", "active", "past_due", "canceled", "expired"].includes(
        value.status,
      )
    )
      return { hit: false };
    if (value.periodEnd !== null) {
      if (typeof value.periodEnd !== "string") return { hit: false };
      value.periodEnd = new Date(value.periodEnd);
      if (!Number.isFinite(value.periodEnd.getTime())) return { hit: false };
    }
    return { hit: true, value: value as Entitlement };
  } catch {
    return { hit: false };
  }
}

export function redisCache(options: RedisCacheOptions): CacheAdapter {
  const { client } = options;
  const prefix = options.prefix ?? "billing:";
  if (!prefix) throw new Error("Redis cache prefix must not be empty");
  const key = (customerRef: string) => `${prefix}entitlement:${customerRef}`;
  async function lookup(customerRef: string): Promise<CacheLookup> {
    const data = await client.get(key(customerRef));
    return data === null ? { hit: false } : deserialize(data);
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
      if (ttlMs === 0) {
        await client.del(key(customerRef));
        return;
      }
      await client.set(
        key(customerRef),
        JSON.stringify({ entitlement }),
        "PX",
        Math.ceil(ttlMs),
      );
    },
    async invalidate(customerRef) {
      await client.del(key(customerRef));
    },
    async invalidateAll() {
      // Escape Redis glob syntax so a prefix cannot select another app's keys.
      const pattern = `${prefix.replace(/[\\*?\[\]]/g, "\\$&")}entitlement:*`;
      let cursor = "0";
      do {
        const [next, keys] = await client.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100,
        );
        cursor = next;
        // COUNT is a hint, so enforce bounded deletion batches ourselves.
        for (let offset = 0; offset < keys.length; offset += 100) {
          await client.del(...keys.slice(offset, offset + 100));
        }
      } while (cursor !== "0");
    },
  };
}
