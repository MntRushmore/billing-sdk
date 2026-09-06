import { describe, it, expect, vi } from "vitest";
import { redisCache, type RedisClient } from "./redis.js";
import type { Entitlement } from "../types.js";
const entitlement: Entitlement = {
  active: true,
  status: "active",
  productId: "pro",
  customerRef: "user",
  periodEnd: new Date("2030-01-01"),
  cancelAtPeriodEnd: false,
  provider: "stripe",
};
function setup(prefix?: string) {
  const data = new Map<string, string>();
  const client: RedisClient = {
    get: vi.fn(async (key) => data.get(key) ?? null),
    set: vi.fn(async (key, value) => {
      data.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (...keys) => {
      let count = 0;
      for (const key of keys) if (data.delete(key)) count++;
      return count;
    }),
    scan: vi.fn(async () => ["0", [...data.keys()]] as [string, string[]]),
  };
  return { cache: redisCache({ client, prefix }), client, data };
}
describe("Redis cache", () => {
  it("round-trips Date instances and uses millisecond expiration", async () => {
    const { cache, client } = setup();
    await cache.set("user", entitlement, 500.5);
    const result = await cache.get("user");
    expect(result).toEqual(entitlement);
    expect(result!.periodEnd!.getTime()).toBe(entitlement.periodEnd!.getTime());
    expect(client.set).toHaveBeenCalledWith(
      "billing:entitlement:user",
      expect.any(String),
      "PX",
      501,
    );
  });
  it("distinguishes cached null from a miss", async () => {
    const { cache } = setup();
    expect(await cache.lookup!("user")).toEqual({ hit: false });
    await cache.set("user", null, 100);
    expect(await cache.lookup!("user")).toEqual({ hit: true, value: null });
  });
  it.each([
    "{",
    "null",
    "{}",
    JSON.stringify({ entitlement: {} }),
    JSON.stringify({ entitlement: { ...entitlement, active: "true" } }),
    JSON.stringify({ entitlement: { ...entitlement, periodEnd: "invalid" } }),
  ])("treats malformed data as a miss: %s", async (value) => {
    const { cache, data } = setup();
    data.set("billing:entitlement:user", value);
    expect(await cache.lookup!("user")).toEqual({ hit: false });
  });
  it("preserves null period end", async () => {
    const { cache } = setup();
    await cache.set("user", { ...entitlement, periodEnd: null }, 100);
    expect((await cache.get("user"))?.periodEnd).toBeNull();
  });
  it("does not hide Redis outages", async () => {
    const { cache, client } = setup();
    vi.mocked(client.get).mockRejectedValue(new Error("offline"));
    await expect(cache.get("user")).rejects.toThrow("offline");
  });
  it("uses paginated SCAN and bounded multi-key DEL", async () => {
    const { cache, client } = setup("app[*]:");
    const keys = Array.from(
      { length: 205 },
      (_, n) => `app[*]:entitlement:${n}`,
    );
    vi.mocked(client.scan)
      .mockResolvedValueOnce(["42", keys])
      .mockResolvedValueOnce(["0", ["app[*]:entitlement:last"]]);
    await cache.invalidateAll();
    expect(client.scan).toHaveBeenNthCalledWith(
      1,
      "0",
      "MATCH",
      "app\\[\\*\\]:entitlement:*",
      "COUNT",
      100,
    );
    expect(client.scan).toHaveBeenNthCalledWith(
      2,
      "42",
      "MATCH",
      expect.any(String),
      "COUNT",
      100,
    );
    expect(vi.mocked(client.del).mock.calls.map((args) => args.length)).toEqual(
      [100, 100, 5, 1],
    );
  });
  it("skips deletion for empty scans and deletes zero-TTL values", async () => {
    const { cache, client } = setup();
    await cache.invalidateAll();
    expect(client.del).not.toHaveBeenCalled();
    await cache.set("user", entitlement, 0);
    expect(client.del).toHaveBeenCalledWith("billing:entitlement:user");
    expect(client.set).not.toHaveBeenCalled();
  });
  it.each([-1, Infinity, NaN])("rejects invalid TTL %s", async (ttl) => {
    await expect(setup().cache.set("user", entitlement, ttl)).rejects.toThrow(
      RangeError,
    );
  });
});
