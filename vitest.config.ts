import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./examples/nextjs-app-router", import.meta.url).pathname,
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts", "examples/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
