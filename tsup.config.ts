import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    mock: "src/adapters/mock.ts",
    stripe: "src/adapters/stripe.ts",
    polar: "src/adapters/polar.ts",
    conformance: "src/conformance/index.ts",
    "conformance/mock-harness": "src/conformance/mock-harness.ts",
    "conformance/stripe-harness": "src/conformance/stripe-harness.ts",
    "cli/doctor": "src/cli/doctor.ts",
    cache: "src/cache/index.ts",
    "cache/memory": "src/cache/memory.ts",
    "cache/redis": "src/cache/redis.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
