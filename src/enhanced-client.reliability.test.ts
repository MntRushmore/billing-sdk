import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnhancedClient } from "./enhanced-client.js";
import { definePlans, FeatureAccessError } from "./features/index.js";
import { memoryCache } from "./cache/memory.js";
import { mock } from "./adapters/mock.js";
import type { BillingEvent, Entitlement } from "./types.js";

const entitlement: Entitlement = {
  active: true,
  status: "active",
  productId: "pro",
  customerRef: "user",
  periodEnd: null,
  cancelAtPeriodEnd: false,
  provider: "mock",
};
const req = { body: "", headers: {}, secret: "test" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("entitlement cache reliability", () => {
  it("negative-caches missing subscriptions until null TTL", async () => {
    vi.useFakeTimers();
    const provider = mock();
    const get = vi.spyOn(provider, "getEntitlement");
    const client = createEnhancedClient({
      provider,
      cache: { nullTtlMs: 100 },
    });
    await client.getEntitlement("missing");
    await client.getEntitlement("missing");
    expect(get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    await client.getEntitlement("missing");
    expect(get).toHaveBeenCalledTimes(2);
    await client.dispose();
  });
  it.each([false as const, { cacheNulls: false }, { nullTtlMs: 0 }])(
    "can disable negative caching with %j",
    async (cache) => {
      const provider = mock();
      const get = vi.spyOn(provider, "getEntitlement");
      const client = createEnhancedClient({ provider, cache });
      await client.getEntitlement("missing");
      await client.getEntitlement("missing");
      expect(get).toHaveBeenCalledTimes(2);
      await client.dispose();
    },
  );
  it("coalesces concurrent checks and isolates returned values", async () => {
    const provider = mock();
    const get = vi
      .spyOn(provider, "getEntitlement")
      .mockResolvedValue(entitlement);
    const client = createEnhancedClient({ provider });
    const values = await Promise.all(
      Array.from({ length: 50 }, () => client.getEntitlement("user")),
    );
    expect(get).toHaveBeenCalledTimes(1);
    values[0]!.active = false;
    expect(values[1]!.active).toBe(true);
    expect((await client.getEntitlement("user"))!.active).toBe(true);
    await client.dispose();
  });
  it("does not poison subsequent requests after a provider failure", async () => {
    const provider = mock();
    const get = vi
      .spyOn(provider, "getEntitlement")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(entitlement);
    const client = createEnhancedClient({ provider });
    await expect(client.getEntitlement("user")).rejects.toThrow("offline");
    expect((await client.getEntitlement("user"))?.active).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
    await client.dispose();
  });
  it.each(["single", "all"])(
    "discards stale in-flight reads after %s invalidation",
    async (kind) => {
      const provider = mock();
      const stale = deferred<Entitlement | null>();
      const get = vi
        .spyOn(provider, "getEntitlement")
        .mockReturnValueOnce(stale.promise)
        .mockResolvedValue({
          ...entitlement,
          active: false,
          status: "expired",
        });
      const client = createEnhancedClient({ provider });
      const oldRead = client.getEntitlement("user");
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
      if (kind === "all") await client.invalidateAllCache();
      else await client.invalidateCache("user");
      stale.resolve(entitlement);
      expect((await oldRead)?.active).toBe(false);
      expect((await client.getEntitlement("user"))?.active).toBe(false);
      await client.dispose();
    },
  );
  it("orders invalidation after a slow cache write", async () => {
    const provider = mock();
    const cache = memoryCache({ cleanupIntervalMs: 0 });
    const gate = deferred<void>();
    const originalSet = cache.set.bind(cache);
    const set = vi
      .spyOn(cache, "set")
      .mockImplementationOnce(async (...args) => {
        await gate.promise;
        await originalSet(...args);
      });
    vi.spyOn(provider, "getEntitlement")
      .mockResolvedValueOnce(entitlement)
      .mockResolvedValue({ ...entitlement, active: false });
    const client = createEnhancedClient({
      provider,
      cache: { adapter: cache },
    });
    const first = client.getEntitlement("user");
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    const invalidating = client.invalidateCache("user");
    gate.resolve();
    await invalidating;
    expect((await first)?.active).toBe(false);
    expect((await client.getEntitlement("user"))?.active).toBe(false);
  });
  it.each(["payment.failed", "unmapped"])(
    "invalidates attributable %s webhooks",
    async (type) => {
      const provider = mock();
      const get = vi
        .spyOn(provider, "getEntitlement")
        .mockResolvedValue(entitlement);
      vi.spyOn(provider, "handleWebhook").mockResolvedValue({
        id: "evt",
        provider: "mock",
        occurredAt: new Date(),
        customerRef: "user",
        type,
      } as BillingEvent);
      const client = createEnhancedClient({ provider });
      await client.getEntitlement("user");
      await client.handleWebhook(req);
      await client.getEntitlement("user");
      expect(get).toHaveBeenCalledTimes(2);
      await client.dispose();
    },
  );
  it("does not invalidate unverified events", async () => {
    const provider = mock();
    const get = vi
      .spyOn(provider, "getEntitlement")
      .mockResolvedValue(entitlement);
    const client = createEnhancedClient({ provider });
    await client.getEntitlement("user");
    await expect(client.handleWebhook(req)).rejects.toThrow();
    await client.getEntitlement("user");
    expect(get).toHaveBeenCalledTimes(1);
    await client.dispose();
  });
  it("refreshes at a paid-period boundary before the configured TTL", async () => {
    vi.useFakeTimers();
    const provider = mock();
    const get = vi
      .spyOn(provider, "getEntitlement")
      .mockResolvedValue({
        ...entitlement,
        status: "canceled",
        cancelAtPeriodEnd: true,
        periodEnd: new Date(Date.now() + 100),
      });
    const client = createEnhancedClient({
      provider,
      plans: { pro: { features: ["api"] } },
    });
    expect(await client.hasFeature("user", "api")).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(await client.hasFeature("user", "api")).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
    await client.dispose();
  });
  it("isolates provider accounts with namespaces in a shared cache", async () => {
    const cache = memoryCache({ cleanupIntervalMs: 0 });
    const a = mock();
    const b = mock();
    vi.spyOn(a, "getEntitlement").mockResolvedValue(entitlement);
    const one = createEnhancedClient({
      provider: a,
      cache: { adapter: cache, namespace: "account-a" },
    });
    const two = createEnhancedClient({
      provider: b,
      cache: { adapter: cache, namespace: "account-b" },
    });
    await one.getEntitlement("user");
    expect(await two.getEntitlement("user")).toBeNull();
  });
  it("continues to support legacy custom adapters without lookup", async () => {
    const cache = memoryCache({ cleanupIntervalMs: 0 });
    delete cache.lookup;
    const provider = mock();
    const get = vi
      .spyOn(provider, "getEntitlement")
      .mockResolvedValue(entitlement);
    const client = createEnhancedClient({
      provider,
      cache: { adapter: cache },
    });
    await client.getEntitlement("user");
    await client.getEntitlement("user");
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("does not swallow cache errors or dispose caller-owned adapters", async () => {
    const cache = memoryCache({ cleanupIntervalMs: 0 });
    const dispose = vi.spyOn(cache, "dispose");
    vi.spyOn(cache, "lookup").mockRejectedValue(new Error("Redis offline"));
    const client = createEnhancedClient({
      provider: mock(),
      cache: { adapter: cache },
    });
    await expect(client.getEntitlement("user")).rejects.toThrow(
      "Redis offline",
    );
    await client.dispose();
    expect(dispose).not.toHaveBeenCalled();
  });
});

describe("feature controls", () => {
  const plans = definePlans({
    pro: {
      features: ["api", "export"],
      limits: { seats: 5, storage: "unlimited", disabled: 0 },
    },
    enterprise: { features: "*" },
  });
  function setup(productId = "pro") {
    const provider = mock();
    vi.spyOn(provider, "getEntitlement").mockResolvedValue({
      ...entitlement,
      productId,
    });
    return {
      provider,
      client: createEnhancedClient({ provider, plans, cache: false }),
    };
  }
  it("bulk-checks one snapshot even with cache disabled", async () => {
    const { client, provider } = setup();
    expect(await client.checkFeatures("user", ["api", "admin"])).toEqual({
      api: { allowed: true, reason: "plan_feature", productId: "pro" },
      admin: {
        allowed: false,
        reason: "feature_not_in_plan",
        productId: "pro",
      },
    });
    expect(provider.getEntitlement).toHaveBeenCalledTimes(1);
  });
  it("throws a structured feature access error for route guards", async () => {
    const { client } = setup();
    await expect(client.requireFeature("user", "api")).resolves.toBeUndefined();
    await expect(client.requireFeature("user", "admin")).rejects.toMatchObject({
      name: "FeatureAccessError",
      feature: "admin",
      customerRef: "user",
      result: { allowed: false },
    });
    await expect(client.requireFeature("user", "admin")).rejects.toBeInstanceOf(
      FeatureAccessError,
    );
  });
  it("compares finite, zero, unlimited and missing limits", async () => {
    const { client } = setup();
    expect(await client.checkLimit("user", "seats", 4)).toMatchObject({
      allowed: true,
      limit: 5,
      remaining: 1,
    });
    expect(await client.checkLimit("user", "seats", 4, 2)).toMatchObject({
      allowed: false,
      reason: "limit_exceeded",
    });
    expect(await client.checkLimit("user", "disabled", 0)).toMatchObject({
      allowed: false,
    });
    expect(await client.checkLimit("user", "storage", 1000)).toMatchObject({
      allowed: true,
      limit: "unlimited",
      remaining: null,
    });
    expect(await client.checkLimit("user", "missing", 0)).toMatchObject({
      allowed: false,
      reason: "no_limit_defined",
    });
  });
  it.each([-1, NaN, Infinity, 1.1])(
    "rejects invalid usage %s",
    async (used) => {
      await expect(
        setup().client.checkLimit("user", "seats", used),
      ).rejects.toThrow(RangeError);
    },
  );
  it("denies quotas for inactive subscriptions and inherited property names", async () => {
    const { client, provider } = setup();
    expect((await client.checkLimit("user", "toString", 0)).allowed).toBe(
      false,
    );
    vi.mocked(provider.getEntitlement).mockResolvedValue({
      ...entitlement,
      active: false,
    });
    expect((await client.checkLimit("user", "seats", 0)).allowed).toBe(false);
  });
  it("can deny unknown plans, including object prototype keys", async () => {
    const { provider } = setup("toString");
    const client = createEnhancedClient({
      provider,
      plans,
      defaultFeatures: ["basic"],
      allowUnknownPlans: false,
    });
    expect(await client.getFeatures("user")).toEqual([]);
    expect(await client.checkFeature("user", "basic")).toMatchObject({
      allowed: false,
      reason: "unknown_plan",
    });
    await client.dispose();
  });
  it("validates catalog limits and retains wildcard semantics", async () => {
    expect(() =>
      definePlans({ pro: { features: [], limits: { seats: -1 } } }),
    ).toThrow(RangeError);
    const { client } = setup("enterprise");
    expect(await client.hasFeature("user", "new_feature")).toBe(true);
    expect(await client.getFeatures("user")).toEqual(["api", "export"]);
  });
});
