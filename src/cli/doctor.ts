#!/usr/bin/env node
/**
 * CLI doctor command for billing-sdk
 *
 * Runs quick provider health checks:
 * - Validates environment variables are set
 * - Verifies credentials work by making a test API call
 * - Reports capability summary
 *
 * Usage:
 *   npx @opencoredev/billing-sdk doctor [--provider stripe|polar]
 */

import { stripe } from "../adapters/stripe.js";
import { polar } from "../adapters/polar.js";
import type { BillingProvider } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HealthCheckResult {
  provider: string;
  status: "ok" | "warning" | "error";
  message: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Colors for terminal output
// ---------------------------------------------------------------------------

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function colorize(text: string, color: keyof typeof colors): string {
  // Check if NO_COLOR is set or not a TTY
  if (process.env.NO_COLOR || !process.stdout.isTTY) {
    return text;
  }
  return `${colors[color]}${text}${colors.reset}`;
}

// ---------------------------------------------------------------------------
// Health check implementations
// ---------------------------------------------------------------------------

async function checkStripe(): Promise<HealthCheckResult> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey) {
    return {
      provider: "stripe",
      status: "error",
      message: "STRIPE_SECRET_KEY environment variable not set",
    };
  }

  if (!webhookSecret) {
    return {
      provider: "stripe",
      status: "warning",
      message: "STRIPE_WEBHOOK_SECRET not set (webhooks won't verify)",
      details: { secretKeySet: true, webhookSecretSet: false },
    };
  }

  try {
    const provider = stripe({
      apiKey: secretKey,
      webhookSecret,
    });

    // Try to list one subscription to verify credentials
    const stripeClient = provider.native;
    await stripeClient.subscriptions.list({ limit: 1 });

    return {
      provider: "stripe",
      status: "ok",
      message: "Credentials valid, API reachable",
      details: {
        capabilities: provider.capabilities,
        mode: secretKey.startsWith("sk_test_") ? "test" : "live",
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      provider: "stripe",
      status: "error",
      message: `API check failed: ${errorMessage}`,
    };
  }
}

async function checkPolar(): Promise<HealthCheckResult> {
  const accessToken = process.env.POLAR_ACCESS_TOKEN;
  const webhookSecret = process.env.POLAR_WEBHOOK_SECRET;

  if (!accessToken) {
    return {
      provider: "polar",
      status: "error",
      message: "POLAR_ACCESS_TOKEN environment variable not set",
    };
  }

  if (!webhookSecret) {
    return {
      provider: "polar",
      status: "warning",
      message: "POLAR_WEBHOOK_SECRET not set (webhooks won't verify)",
      details: { accessTokenSet: true, webhookSecretSet: false },
    };
  }

  try {
    // Check for sandbox indicator in token or env
    const sandbox = process.env.POLAR_SANDBOX === "true";

    const provider = polar({
      accessToken,
      webhookSecret,
      sandbox,
    });

    // Try to list subscriptions to verify credentials
    const polarClient = provider.native;
    await polarClient.subscriptions.list({ limit: 1 });

    return {
      provider: "polar",
      status: "ok",
      message: "Credentials valid, API reachable",
      details: {
        capabilities: provider.capabilities,
        mode: sandbox ? "sandbox" : "production",
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      provider: "polar",
      status: "error",
      message: `API check failed: ${errorMessage}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatResult(result: HealthCheckResult): void {
  const statusIcon =
    result.status === "ok"
      ? colorize("✓", "green")
      : result.status === "warning"
        ? colorize("!", "yellow")
        : colorize("✗", "red");

  const statusColor =
    result.status === "ok"
      ? "green"
      : result.status === "warning"
        ? "yellow"
        : "red";

  console.log(`\n${statusIcon} ${colorize(result.provider.toUpperCase(), "bold")}`);
  console.log(`  ${colorize(result.message, statusColor)}`);

  if (result.details) {
    if (result.details.mode) {
      console.log(`  ${colorize("Mode:", "dim")} ${result.details.mode}`);
    }
    if (result.details.capabilities) {
      const caps = result.details.capabilities as Record<string, boolean>;
      const enabled = Object.entries(caps)
        .filter(([, v]) => v)
        .map(([k]) => k);
      const disabled = Object.entries(caps)
        .filter(([, v]) => !v)
        .map(([k]) => k);

      if (enabled.length > 0) {
        console.log(
          `  ${colorize("Enabled:", "dim")} ${enabled.join(", ")}`
        );
      }
      if (disabled.length > 0) {
        console.log(
          `  ${colorize("Disabled:", "dim")} ${disabled.join(", ")}`
        );
      }
    }
  }
}

function printCapabilityMatrix(results: HealthCheckResult[]): void {
  const okResults = results.filter((r) => r.status === "ok" && r.details?.capabilities);

  if (okResults.length === 0) return;

  console.log(`\n${colorize("Capability Matrix:", "bold")}`);
  console.log(colorize("─".repeat(60), "dim"));

  // Get all capabilities from all providers
  const allCaps = new Set<string>();
  for (const r of okResults) {
    const caps = r.details?.capabilities as Record<string, boolean> | undefined;
    if (caps) {
      Object.keys(caps).forEach((k) => allCaps.add(k));
    }
  }

  // Print header
  const providerNames = okResults.map((r) => r.provider.padEnd(10));
  console.log(`${"Capability".padEnd(25)} ${providerNames.join(" ")}`);
  console.log(colorize("─".repeat(60), "dim"));

  // Print each capability
  for (const cap of allCaps) {
    const values = okResults.map((r) => {
      const caps = r.details?.capabilities as Record<string, boolean> | undefined;
      const val = caps?.[cap];
      return val
        ? colorize("✓".padEnd(10), "green")
        : colorize("–".padEnd(10), "dim");
    });
    console.log(`${cap.padEnd(25)} ${values.join(" ")}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse args
  let specificProvider: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--provider" && args[i + 1]) {
      specificProvider = args[i + 1];
    }
    if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
${colorize("billing-sdk doctor", "bold")}

Run health checks on your billing providers.

${colorize("Usage:", "cyan")}
  npx @opencoredev/billing-sdk doctor [options]

${colorize("Options:", "cyan")}
  --provider <name>   Check only this provider (stripe, polar)
  --help, -h          Show this help message

${colorize("Environment Variables:", "cyan")}
  STRIPE_SECRET_KEY        Stripe API secret key
  STRIPE_WEBHOOK_SECRET    Stripe webhook signing secret

  POLAR_ACCESS_TOKEN       Polar API access token
  POLAR_WEBHOOK_SECRET     Polar webhook signing secret
  POLAR_SANDBOX            Set to "true" for sandbox mode
`);
      process.exit(0);
    }
  }

  console.log(colorize("\nbilling-sdk doctor\n", "bold"));
  console.log(colorize("Checking provider health...", "dim"));

  const checks: Array<() => Promise<HealthCheckResult>> = [];

  if (!specificProvider || specificProvider === "stripe") {
    checks.push(checkStripe);
  }
  if (!specificProvider || specificProvider === "polar") {
    checks.push(checkPolar);
  }

  if (checks.length === 0) {
    console.error(colorize(`Unknown provider: ${specificProvider}`, "red"));
    process.exit(1);
  }

  const results = await Promise.all(checks.map((check) => check()));

  for (const result of results) {
    formatResult(result);
  }

  // Show capability matrix if multiple providers are ok
  printCapabilityMatrix(results);

  // Exit with error code if any check failed
  const hasError = results.some((r) => r.status === "error");
  if (hasError) {
    console.log(
      `\n${colorize("Some checks failed. Set the required environment variables.", "yellow")}`
    );
    process.exit(1);
  }

  console.log(`\n${colorize("All checks passed!", "green")}\n`);
}

main().catch((err) => {
  console.error(colorize(`Fatal error: ${err}`, "red"));
  process.exit(1);
});
