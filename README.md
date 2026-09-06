# @fuime/billing-sdk

**One TypeScript API for subscription access across Stripe, Polar, and a local testing provider.**

Define which features belong to each product, then ask whether a customer can use them. Provider-native checkout, subscription status, signed webhooks, and optional caching sit behind the same interface.

Requires Node.js 22+. Works with ESM and CommonJS. Server-side only: keep provider keys and access decisions on your server.

## Try it without payment credentials

```bash
pnpm add @fuime/billing-sdk
```

```ts
import { createEnhancedClient, definePlans } from "@fuime/billing-sdk";
import { mock } from "@fuime/billing-sdk/mock";

const provider = mock();
provider._testing.createSubscription({
  customerRef: "user_123",
  productId: "prod_pro",
});

const billing = createEnhancedClient({
  provider,
  plans: definePlans({
    prod_pro: {
      features: ["exports", "api"],
      limits: { seats: 5, projects: 20 },
    },
    prod_enterprise: {
      features: "*",
      limits: { seats: "unlimited" },
    },
  }),
  defaultFeatures: ["read"],
});

await billing.hasFeature("user_123", "api"); // true
await billing.checkFeatures("user_123", ["api", "sso"]);
// { api: { allowed: true, ... }, sso: { allowed: false, ... } }

await billing.checkLimit("user_123", "seats", 4);
// { allowed: true, reason: "within_limit", limit: 5, remaining: 1 }

await billing.dispose(); // Releases the internally owned memory cache.
```

`definePlans` preserves literal types and validates features and quotas. It does not make `hasFeature` reject undeclared strings at compile time. A wildcard grants any feature string; `getFeatures` can enumerate only features declared in this catalog or in defaults.

## Connect a provider

### Stripe

```bash
pnpm add stripe
```

```ts
import { createEnhancedClient } from "@fuime/billing-sdk";
import { stripe } from "@fuime/billing-sdk/stripe";

const billing = createEnhancedClient({
  provider: stripe({
    apiKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
    // Recommended once your application stores Stripe customer IDs:
    // resolveCustomerId: async userId => db.users.getStripeCustomerId(userId),
  }),
  plans: {
    prod_pro: { features: ["exports", "api"], limits: { seats: 5 } },
  },
});

const checkout = await billing.createCheckout({
  customerRef: authenticatedUser.id, // From server-verified authentication.
  priceId: "price_pro_monthly", // From your server's allowed catalog.
  successUrl: "https://your-app.com/billing/success",
  cancelUrl: "https://your-app.com/pricing",
});
```

**Plan keys are Stripe product IDs (`prod_`); checkout takes price IDs (`price_`).** Multiple monthly/yearly prices for one product share the same feature definition.

Without `resolveCustomerId`, the adapter searches subscription metadata. Stripe Search is eventually consistent, so a checkout or update may not appear immediately. A database-backed customer mapping switches reads to paginated subscription listing and reuses existing customers during checkout. The resolver is a trusted server-side identity mapping.

Both subscription-level billing periods and newer item-level periods are supported. For a subscription with several items, the first item's product and billing period are used. The singular entitlement API prefers an accessible subscription, then the newest creation; it does not combine multiple subscriptions or add-ons.

### Polar

```ts
import { polar } from "@fuime/billing-sdk/polar";

const provider = polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
  sandbox: true,
});
```

Polar's checkout `priceId` means a Polar **product ID**. The adapter sets external customer identity and protected subscription metadata, filters subscriptions on the server, and follows pagination. Existing subscriptions need `billing_sdk_customer_ref` metadata for lookup. API errors propagate; an outage is not returned as “no subscription.”

Polar is the merchant of record. Inspect `billing.capabilities` for provider differences; use `billing.native<T>()` for operations outside the unified contract. A full Polar refund uses the order's remaining refundable amount when no amount is supplied.

## Feature checks and route guards

| Method                                          | Result                                                     |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `getEntitlement(userId)`                        | Provider entitlement or `null`                             |
| `hasFeature(userId, feature)`                   | Boolean access decision                                    |
| `checkFeature(userId, feature)`                 | Decision, reason, and product ID when available            |
| `checkFeatures(userId, features)`               | Named decisions from one entitlement snapshot              |
| `getFeatures(userId)`                           | Available feature names                                    |
| `requireFeature(userId, feature)`               | Resolves on access; throws `FeatureAccessError` on denial  |
| `checkLimit(userId, name, used, requested = 1)` | Quota decision and remaining capacity before the operation |
| `invalidateCache(userId)`                       | Evicts that customer's cached entitlement                  |
| `invalidateAllCache()`                          | Clears all entries in the configured cache adapter's scope |
| `dispose()`                                     | Releases the client's internally owned memory cache        |

```ts
import { FeatureAccessError } from "@fuime/billing-sdk";

try {
  await billing.requireFeature(authenticatedUser.id, "api");
  // Perform the protected operation.
} catch (error) {
  if (error instanceof FeatureAccessError) {
    // Translate to HTTP 403 or an upgrade prompt.
    console.log(error.result.reason);
  } else {
    throw error; // Provider/cache failures are operational errors.
  }
}
```

Default features apply to customers without an active subscription. Known paid plans use their own feature list, so include free features explicitly if paid users should retain them. Unknown paid products receive defaults for backward compatibility; set `allowUnknownPlans: false` to deny them.

`checkLimit` compares a usage snapshot supplied by your app. It does **not** meter, increment, reserve, or invoice usage. Store counters in your database and enforce concurrent changes in a transaction. Undefined quotas deny access, even on wildcard feature plans. Usage and requested amounts must be nonnegative safe integers; quota values are nonnegative integers or `"unlimited"`.

## Caching

```ts
const billing = createEnhancedClient({
  provider,
  cache: {
    ttlMs: 60_000,
    nullTtlMs: 10_000,
    cacheNulls: true,
    namespace: "my-app:production:stripe-account-1",
  },
});
```

Defaults are a bounded memory cache, one-minute entitlement TTL, and ten-second negative TTL. Set `cache: false` to bypass storage. Concurrent requests to the same customer share an in-flight read even with storage disabled. Zero TTL disables storage for that result; invalid TTLs fail at construction.

Cached values are copied to prevent accidental mutation. Active cache entries are capped at the known paid-period boundary, forcing a provider refresh at that point. A canceled subscription cannot retain access beyond its known period end.

Memory cache supports LRU eviction, `getStats`, `resetStats`, and `dispose`. A custom cache remains owned by the caller and is not disposed by the billing client. Use separate cache instances or Redis prefixes if `invalidateAllCache` must be isolated between applications/accounts; key namespaces alone do not narrow a full adapter clear.

### Redis

```ts
import Redis from "ioredis";
import { redisCache } from "@fuime/billing-sdk/cache/redis";

const redis = new Redis(process.env.REDIS_URL!);
const cache = redisCache({
  client: redis,
  prefix: "my-app:prod:stripe-account-1:",
});
const billing = createEnhancedClient({ provider, cache: { adapter: cache } });
```

Redis values restore `periodEnd` as a `Date`. Malformed stored data is a miss; Redis connection failures propagate. Bulk invalidation uses paginated `SCAN` and bounded `DEL`, not blocking `KEYS`.

The adapter accepts ioredis-style commands. For node-redis, bridge its command shapes explicitly:

```ts
const cache = redisCache({
  prefix: "my-app:prod:",
  client: {
    get: (key) => redis.get(key),
    set: (key, value, _mode, ttl) => redis.set(key, value, { PX: ttl }),
    del: (...keys) => redis.del(keys),
    scan: async (cursor, _match, pattern, _count, count) => {
      const page = await redis.scan(cursor, { MATCH: pattern, COUNT: count });
      return [String(page.cursor), page.keys];
    },
  },
});
```

Match the cursor type required by your installed node-redis major version (older versions use a numeric cursor).

**Consistency boundary:** invalidation prevents older reads/writes from restoring stale state within one client instance. Redis shares cache storage and invalidations between servers, but this SDK does not implement a distributed generation check or lock. An in-flight read on another server may repopulate old state until TTL. Use short TTLs, no cache for strict checks, or a transactionally maintained entitlement store where stronger guarantees are required. Cache mutations are serialized within a client.

### Custom adapters

Existing adapters can keep implementing `get`, `set`, `invalidate`, and `invalidateAll`. To support negative caching, also implement:

```ts
lookup(customerRef: string): Promise<
  | { hit: false }
  | { hit: true; value: Entitlement | null }
>;
```

Legacy `get()` cannot distinguish cached `null` from a miss, so negative caching is unavailable for adapters without `lookup`. Built-in adapters implement it.

## Webhooks

Always pass the raw body. Do not parse and reserialize before verification.

```ts
const event = await billing.handleWebhook({
  body: await request.text(),
  headers: Object.fromEntries(request.headers),
  secret: process.env.BILLING_WEBHOOK_SECRET!,
});
```

The per-request `secret` is authoritative; it must match the configured endpoint secret. Header names are case-insensitive. Invalid signatures throw `WebhookVerificationError`. Verified but malformed Polar payloads throw parsing/validation errors separately.

Every verified event with a known customer reference invalidates that customer's cache, including payment failures and unmapped subscription updates. Events without attribution cannot invalidate a specific customer.

| Normalized event                       | Meaning                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `subscription.started`                 | Subscription created; inspect `entitlement.active` before granting access |
| `subscription.renewed`                 | Recognized billing-period renewal                                         |
| `subscription.canceled`                | Cancellation scheduled; access can continue through the paid period       |
| `subscription.ended`                   | Subscription ended; access revoked                                        |
| `payment.succeeded` / `payment.failed` | Payment outcome, amount in minor currency units                           |
| `refund.issued`                        | Provider refund notification                                              |
| `unmapped`                             | Verified event outside this set; original data and provider type retained |

Stripe event IDs and Polar `webhook-id` values remain stable across retries. Persist `(provider, event.id)` with your business changes in a database transaction before sending emails or performing other non-idempotent side effects. The SDK does not deduplicate your application handlers or order provider deliveries. Refund notifications from Stripe charges and Polar orders report cumulative refunded amounts, not necessarily a new refund delta.

## Example and development

See [the Next.js App Router example](examples/nextjs-app-router/README.md) for server-authenticated checkout, form/JSON handling, raw webhooks, and product-based feature gates.

```bash
pnpm install --frozen-lockfile
pnpm check                       # Types, tests, build, package smoke checks
pnpm --filter billing-sdk-nextjs-example build
pnpm exec billing-sdk doctor --provider stripe
```

Provider tests use signed fixtures and mocked API boundaries; they do not charge real accounts. Test a checkout, renewal, failed payment, cancellation, portal, and refund in provider sandbox accounts before release. The mock adapter is for development/testing only.

For the thin provider wrapper without feature gates, use `createBillingClient({ provider })`. Adapter authors can use the exported `@fuime/billing-sdk/conformance` Vitest harness.

See [CHANGELOG.md](CHANGELOG.md) for migration notes and [CONTRIBUTING.md](CONTRIBUTING.md) for contributions.

## Provider references

- [Stripe subscription item billing periods](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end)
- [Stripe Search limitations](https://docs.stripe.com/search#limitations)
- [Polar subscription filtering](https://polar.sh/docs/api-reference/subscriptions/list)
- [Polar customer identity](https://polar.sh/docs/features/customer-management)

## License

MIT (see package metadata).
