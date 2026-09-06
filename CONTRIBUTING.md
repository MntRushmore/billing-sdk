# Contributing to billing-sdk

Thanks for your interest in contributing!

## Development Setup

```bash
# Clone the repo
git clone https://github.com/opencoredev/billing-sdk.git
cd billing-sdk

# Install dependencies
pnpm install

# Run tests
pnpm test

# Build
pnpm build
```

## Project Structure

```
src/
├── adapters/           # Provider implementations
│   ├── mock.ts         # Mock adapter for testing
│   ├── stripe.ts       # Stripe adapter
│   └── polar.ts        # Polar adapter
├── cache/              # Caching layer
│   ├── memory.ts       # In-memory cache
│   └── redis.ts        # Redis cache
├── conformance/        # Conformance test suite
├── features/           # Feature gating types
├── cli/                # CLI commands
├── client.ts           # Basic client
├── enhanced-client.ts  # Enhanced client with cache + features
├── types.ts            # Core types
└── index.ts            # Main exports
```

## Adding a New Provider

1. Create `src/adapters/your-provider.ts`
2. Implement the `BillingProvider` interface
3. Add exports to `tsup.config.ts` and `package.json`
4. Create a conformance harness in `src/conformance/`
5. Add tests in `src/adapters/your-provider.test.ts`
6. Update the README capability matrix

### Provider Requirements

- Must implement all required `BillingProvider` methods
- `capabilities` must be truthful - don't claim features you can't do
- Unknown webhook events must return `{ type: "unmapped" }`, never silently drop
- `subscription.canceled` ≠ `subscription.ended` - handle both correctly
- Store `customerRef` in subscription metadata so webhooks can attribute events

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test

# Run tests once
pnpm test:run

# Run specific test file
pnpm test src/adapters/stripe.test.ts
```

## Code Style

- TypeScript strict mode
- No `any` types (use `unknown` if needed)
- Prefer discriminated unions for events
- Document public APIs with JSDoc comments

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Add tests for new functionality
3. Ensure all tests pass: `pnpm test:run`
4. Ensure types check: `pnpm typecheck`
5. Update README if adding features
6. Open a PR with a clear description

## Release Process (maintainers)

1. Update version in `package.json`
2. Create a git tag: `git tag v0.x.x`
3. Push tag: `git push origin v0.x.x`
4. GitHub Actions will publish to npm
