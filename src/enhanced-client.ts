import type {
  BillingClient,
  BillingEvent,
  BillingProvider,
  Entitlement,
} from "./types.js";
import type { CacheAdapter, CacheOptions } from "./cache/types.js";
import type {
  PlanConfig,
  FeatureCheckResult,
  LimitCheckResult,
} from "./features/types.js";
import { FeatureAccessError, definePlans } from "./features/index.js";
import { memoryCache } from "./cache/memory.js";

export interface EnhancedClientOptions {
  provider: BillingProvider;
  /** Caching is enabled by default. Custom adapters remain owned by the caller. */
  cache?: CacheOptions | false;
  plans?: PlanConfig;
  defaultFeatures?: readonly string[];
  /** Defaults to true for compatibility. Set false to deny unknown paid plans. */
  allowUnknownPlans?: boolean;
}

export interface EnhancedBillingClient extends BillingClient {
  hasFeature(customerRef: string, feature: string): Promise<boolean>;
  /** Wildcard plans enumerate only features declared somewhere in this config. */
  getFeatures(customerRef: string): Promise<string[]>;
  checkFeature(
    customerRef: string,
    feature: string,
  ): Promise<FeatureCheckResult>;
  /** Evaluate several features using one entitlement snapshot. */
  checkFeatures(
    customerRef: string,
    features: readonly string[],
  ): Promise<Record<string, FeatureCheckResult>>;
  /** Throw FeatureAccessError when access is denied. */
  requireFeature(customerRef: string, feature: string): Promise<void>;
  /** Compare a caller-supplied usage snapshot; does not record or reserve usage. */
  checkLimit(
    customerRef: string,
    limit: string,
    used: number,
    requested?: number,
  ): Promise<LimitCheckResult>;
  invalidateCache(customerRef: string): Promise<void>;
  invalidateAllCache(): Promise<void>;
  /** Dispose only the internally created cache. */
  dispose(): Promise<void>;
}

export function createEnhancedClient(
  options: EnhancedClientOptions,
): EnhancedBillingClient {
  const { provider, allowUnknownPlans = true } = options;
  const plans = definePlans(structuredClone(options.plans ?? {}));
  const defaultFeatures = [...new Set(options.defaultFeatures ?? [])];
  const cacheOptions =
    options.cache === false ? undefined : (options.cache ?? {});
  const ttlMs = cacheOptions?.ttlMs ?? 60_000;
  const nullTtlMs = cacheOptions?.nullTtlMs ?? 10_000;
  for (const ttl of [ttlMs, nullTtlMs]) {
    if (!Number.isFinite(ttl) || ttl < 0)
      throw new RangeError("Cache TTL must be nonnegative and finite");
  }
  const cache: CacheAdapter | null = cacheOptions
    ? (cacheOptions.adapter ?? memoryCache())
    : null;
  const namespace = cacheOptions?.namespace ?? provider.name;
  const key = (ref: string) => `${namespace.length}:${namespace}:${ref}`;
  const allFeatures = new Set(defaultFeatures);
  for (const plan of Object.values(plans)) {
    if (plan.features !== "*")
      for (const feature of plan.features) allFeatures.add(feature);
  }
  const getPlan = (id: string) =>
    Object.hasOwn(plans, id) ? plans[id] : undefined;

  // Coalesce concurrent reads. Serialize cache mutations so a slow write cannot
  // land after an invalidation. Epochs also discard stale provider responses.
  // This coordination is local to this client, not a distributed lock.
  const pending = new Map<
    string,
    { promise: Promise<Entitlement | null>; invalidated: boolean }
  >();
  let epoch = 0;
  let mutations: Promise<void> = Promise.resolve();
  function mutate(action: () => Promise<void>): Promise<void> {
    const operation = mutations.then(action);
    mutations = operation.catch(() => {});
    return operation;
  }
  function current(value: Entitlement | null): Entitlement | null {
    if (!value) return null;
    const result = structuredClone(value);
    if (
      result.status === "canceled" &&
      result.periodEnd &&
      result.periodEnd.getTime() <= Date.now()
    ) {
      result.active = false;
      result.status = "expired";
    }
    return result;
  }
  async function read(
    ref: string,
    token: { invalidated: boolean },
  ): Promise<Entitlement | null> {
    while (true) {
      const version = epoch;
      await mutations;
      if (cache) {
        const cached = cache.lookup
          ? await cache.lookup(key(ref))
          : await cache
              .get(key(ref))
              .then((value) =>
                value === null
                  ? { hit: false as const }
                  : { hit: true as const, value },
              );
        if (version !== epoch || token.invalidated) return getEntitlement(ref);
        if (cached.hit) return current(cached.value);
      }
      const value = current(await provider.getEntitlement(ref));
      if (version !== epoch || token.invalidated) return getEntitlement(ref);
      if (cache && (value !== null || cacheOptions?.cacheNulls !== false)) {
        let ttl = value === null ? nullTtlMs : ttlMs;
        if (value?.active && value.periodEnd)
          ttl = Math.min(
            ttl,
            Math.max(0, value.periodEnd.getTime() - Date.now()),
          );
        if (ttl > 0)
          await mutate(async () => {
            if (version === epoch && !token.invalidated)
              await cache.set(key(ref), value, ttl);
          });
      }
      if (version === epoch && !token.invalidated) return value;
      return getEntitlement(ref);
    }
  }
  async function getEntitlement(ref: string): Promise<Entitlement | null> {
    let request = pending.get(ref);
    if (!request) {
      const token = {
        invalidated: false,
        promise: undefined as unknown as Promise<Entitlement | null>,
      };
      token.promise = read(ref, token);
      request = token;
      pending.set(ref, request);
    }
    try {
      return current(await request.promise);
    } finally {
      if (pending.get(ref) === request) pending.delete(ref);
    }
  }
  function check(
    entitlement: Entitlement | null,
    feature: string,
  ): FeatureCheckResult {
    const productId = entitlement?.productId;
    if (!entitlement?.active) {
      const allowed = defaultFeatures.includes(feature);
      return {
        allowed,
        reason: allowed ? "default" : "no_subscription",
        ...(productId ? { productId } : {}),
      };
    }
    const plan = getPlan(entitlement.productId);
    if (!plan) {
      const allowed = allowUnknownPlans && defaultFeatures.includes(feature);
      return {
        allowed,
        reason: allowed ? "default" : "unknown_plan",
        productId,
      };
    }
    const allowed = plan.features === "*" || plan.features.includes(feature);
    return {
      allowed,
      reason: allowed ? "plan_feature" : "feature_not_in_plan",
      productId,
    };
  }

  const client: EnhancedBillingClient = {
    get name() {
      return provider.name;
    },
    get capabilities() {
      return provider.capabilities;
    },
    getEntitlement,
    createCheckout: provider.createCheckout.bind(provider),
    ...(provider.createPortalSession && {
      createPortalSession: provider.createPortalSession.bind(provider),
    }),
    ...(provider.refund && { refund: provider.refund.bind(provider) }),
    native<T>(): T {
      return provider.native as T;
    },
    async handleWebhook(req): Promise<BillingEvent> {
      const event = await provider.handleWebhook(req);
      // Even unmapped status/product changes and payment failures can affect access.
      if (event.customerRef !== null)
        await client.invalidateCache(event.customerRef);
      return event;
    },
    async hasFeature(ref, feature) {
      return (await client.checkFeature(ref, feature)).allowed;
    },
    async checkFeature(ref, feature) {
      return check(await getEntitlement(ref), feature);
    },
    async checkFeatures(ref, features) {
      const entitlement = await getEntitlement(ref);
      return Object.fromEntries(
        features.map((feature) => [feature, check(entitlement, feature)]),
      );
    },
    async requireFeature(ref, feature) {
      const result = await client.checkFeature(ref, feature);
      if (!result.allowed) throw new FeatureAccessError(ref, feature, result);
    },
    async getFeatures(ref) {
      const entitlement = await getEntitlement(ref);
      if (!entitlement?.active) return [...defaultFeatures];
      const plan = getPlan(entitlement.productId);
      if (!plan) return allowUnknownPlans ? [...defaultFeatures] : [];
      return plan.features === "*"
        ? [...allFeatures]
        : [...new Set(plan.features)];
    },
    async checkLimit(ref, name, used, requested = 1) {
      if (
        ![used, requested].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        )
      ) {
        throw new RangeError(
          "used and requested must be nonnegative safe integers",
        );
      }
      const entitlement = await getEntitlement(ref);
      const limits = entitlement?.active
        ? getPlan(entitlement.productId)?.limits
        : undefined;
      const limit =
        limits && Object.hasOwn(limits, name) ? limits[name] : undefined;
      if (limit === undefined)
        return {
          allowed: false,
          reason: "no_limit_defined",
          limit: null,
          remaining: null,
        };
      if (limit === "unlimited")
        return {
          allowed: true,
          reason: "within_limit",
          limit,
          remaining: null,
        };
      return {
        allowed: used <= limit && requested <= limit - used,
        reason:
          used <= limit && requested <= limit - used
            ? "within_limit"
            : "limit_exceeded",
        limit,
        remaining: Math.max(0, limit - used),
      };
    },
    async invalidateCache(ref) {
      const request = pending.get(ref);
      if (request) request.invalidated = true;
      pending.delete(ref);
      if (cache) await mutate(() => cache.invalidate(key(ref)));
    },
    async invalidateAllCache() {
      epoch++;
      pending.clear();
      if (cache) await mutate(() => cache.invalidateAll());
    },
    async dispose() {
      epoch++;
      pending.clear();
      await mutations;
      if (cache && !cacheOptions?.adapter) await cache.dispose?.();
    },
  };
  return client;
}
