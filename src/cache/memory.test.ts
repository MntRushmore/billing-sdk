/**
 * Memory cache adapter tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { memoryCache } from "./memory.js";
import type { Entitlement } from "../types.js";

const mockEntitlement: Entitlement = {
  active: true,
  status: "active",
  productId: "prod_test",
  customerRef: "user_123",
  periodEnd: new Date("2025-12-31"),
  cancelAtPeriodEnd: false,
  provider: "mock",
};

describe("memoryCache", () => {
  let cache: ReturnType<typeof memoryCache>;

  beforeEach(() => {
    cache = memoryCache();
  });

  describe("basic operations", () => {
    it("returns null for cache miss", async () => {
      const result = await cache.get("nonexistent");
      expect(result).toBeNull();
    });

    it("stores and retrieves entitlement", async () => {
      await cache.set("user_123", mockEntitlement, 60_000);
      const result = await cache.get("user_123");
      expect(result).toEqual(mockEntitlement);
    });

    it("stores null (no subscription) values", async () => {
      await cache.set("user_no_sub", null, 60_000);
      // Note: get returns null for both "not cached" and "cached null"
      // This is intentional - the consumer treats them the same for caching purposes
      const result = await cache.get("user_no_sub");
      expect(result).toBeNull();
    });

    it("invalidates single entry", async () => {
      await cache.set("user_123", mockEntitlement, 60_000);
      await cache.invalidate("user_123");
      const result = await cache.get("user_123");
      expect(result).toBeNull();
    });

    it("invalidates all entries", async () => {
      await cache.set("user_1", mockEntitlement, 60_000);
      await cache.set("user_2", { ...mockEntitlement, customerRef: "user_2" }, 60_000);
      await cache.invalidateAll();

      expect(await cache.get("user_1")).toBeNull();
      expect(await cache.get("user_2")).toBeNull();
    });
  });

  describe("TTL expiration", () => {
    it("expires entries after TTL", async () => {
      await cache.set("user_123", mockEntitlement, 1); // 1ms TTL
      await new Promise((r) => setTimeout(r, 10)); // Wait for expiration
      const result = await cache.get("user_123");
      expect(result).toBeNull();
    });

    it("returns value before TTL expires", async () => {
      await cache.set("user_123", mockEntitlement, 10_000); // 10s TTL
      const result = await cache.get("user_123");
      expect(result).toEqual(mockEntitlement);
    });
  });

  describe("maxSize eviction", () => {
    it("evicts oldest entries when at capacity", async () => {
      const smallCache = memoryCache({ maxSize: 2 });

      await smallCache.set("user_1", mockEntitlement, 60_000);
      await smallCache.set("user_2", { ...mockEntitlement, customerRef: "user_2" }, 60_000);
      await smallCache.set("user_3", { ...mockEntitlement, customerRef: "user_3" }, 60_000);

      // user_1 should be evicted (oldest)
      expect(await smallCache.get("user_1")).toBeNull();
      expect(await smallCache.get("user_2")).toBeDefined();
      expect(await smallCache.get("user_3")).toBeDefined();
    });
  });

  describe("stats tracking", () => {
    it("tracks hits and misses", async () => {
      await cache.set("user_123", mockEntitlement, 60_000);

      await cache.get("user_123"); // hit
      await cache.get("user_123"); // hit
      await cache.get("nonexistent"); // miss

      const stats = cache.getStats!();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it("tracks invalidations", async () => {
      await cache.set("user_1", mockEntitlement, 60_000);
      await cache.set("user_2", mockEntitlement, 60_000);

      await cache.invalidate("user_1");
      await cache.invalidateAll();

      const stats = cache.getStats!();
      expect(stats.invalidations).toBe(2); // 1 single + 1 from invalidateAll
    });

    it("tracks size", async () => {
      await cache.set("user_1", mockEntitlement, 60_000);
      await cache.set("user_2", mockEntitlement, 60_000);

      const stats = cache.getStats!();
      expect(stats.size).toBe(2);
    });

    it("resets stats", async () => {
      await cache.set("user_123", mockEntitlement, 60_000);
      await cache.get("user_123");

      cache.resetStats!();
      const stats = cache.getStats!();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.invalidations).toBe(0);
      expect(stats.size).toBe(1); // Size is preserved
    });
  });
});
