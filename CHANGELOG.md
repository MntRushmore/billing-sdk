# Changelog

## Unreleased

### Added

- `definePlans` with literal inference and runtime catalog validation.
- `checkFeatures` to evaluate several features from one entitlement snapshot.
- `requireFeature` and structured `FeatureAccessError` for server route guards.
- Plan quotas and `checkLimit`, including zero and unlimited quotas.
- `allowUnknownPlans`, account-specific cache namespaces, and cache disposal.
- Stripe `resolveCustomerId` for direct customer reads and checkout reuse.
- Redis regression tests, signed Polar tests, concurrent cache tests, checkout route tests, and built-package smoke checks.

### Fixed

- Negative caching, duplicate concurrent provider calls, caller mutation of cached values, cancellation expiry, and stale writes racing local invalidation.
- Cache invalidation for attributable payment failures and unmapped provider updates.
- Redis Date restoration, malformed values, glob escaping, millisecond TTL validation, and blocking full-cache key enumeration.
- Polar camelCase SDK response handling, server-side filtered pagination, swallowed API failures, webhook identity/timestamps, future event preservation, order/refund amounts, and full remaining refunds.
- Stripe reserved metadata overrides, search escaping, active subscription selection, pagination, modern item-level periods, invoice attribution, and false cancellation classification.
- Mock renewal cancellation flag and exact period-end access boundary.
- Next.js price/product ID confusion, request-body identity trust, form/JSON mismatch, checkout redirects, missing completion pages, and webhook error classification.
- ESM/CommonJS declaration routing and CLI help requiring an optional Stripe installation.

### Migration and limits

- Redis clients now need `scan`, variadic `del`, and ioredis-style `set(..., "PX", ttl)`. `keys` is no longer used. node-redis requires the explicit bridge in README.
- Client cache keys now include a namespace (provider name by default). Existing entries naturally expire. Give separate provider accounts separate namespaces and Redis prefixes.
- Custom caches should add optional `lookup` to distinguish cached null from a miss. Existing adapters continue to work without negative caching.
- Every attributable verified webhook invalidates cache, so payment and unmapped events can increase provider read volume.
- Next.js checkout now requires integration with a real server-side auth session and separate product/price environment variables.
- Concurrency protection is per client, not distributed. The SDK still exposes a single selected subscription/item, not aggregate add-on entitlements.
- Numeric quotas compare caller-provided usage; usage storage, transactional reservation, metered billing, and webhook business-side-effect deduplication remain application responsibilities.
- No npm version bump or package publication is included in this change.
