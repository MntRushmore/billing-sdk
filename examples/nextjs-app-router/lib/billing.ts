import {
  createEnhancedClient,
  type EnhancedBillingClient,
} from "@fuime/billing-sdk";
import { stripe } from "@fuime/billing-sdk/stripe";

let client: EnhancedBillingClient | undefined;
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
/** Lazy initialization lets the signed-out example render without credentials. */
export function getBilling(): EnhancedBillingClient {
  return (client ??= createEnhancedClient({
    provider: stripe({
      apiKey: required("STRIPE_SECRET_KEY"),
      webhookSecret: required("STRIPE_WEBHOOK_SECRET"),
      // Production: add resolveCustomerId using your authenticated user's DB mapping.
    }),
    cache: { ttlMs: 60_000, nullTtlMs: 10_000 },
    plans: {
      // Entitlements contain PRODUCT IDs (prod_), checkout uses PRICE IDs (price_).
      [required("STRIPE_PRO_PRODUCT_ID")]: {
        features: [
          "basic_export",
          "csv_export",
          "api_access",
          "priority_support",
        ],
        limits: { seats: 5 },
      },
      [required("STRIPE_ENTERPRISE_PRODUCT_ID")]: {
        features: "*",
        limits: { seats: "unlimited" },
      },
    },
    defaultFeatures: ["basic_export"],
    allowUnknownPlans: false,
  }));
}

/** Replace with a server-verified session from your auth provider. Never read
 * identity from checkout request bodies or unsigned user-ID cookies. */
export async function getCurrentUserId(): Promise<string | null> {
  return null;
}

export const FEATURES = {
  BASIC_EXPORT: "basic_export",
  CSV_EXPORT: "csv_export",
  API_ACCESS: "api_access",
  PRIORITY_SUPPORT: "priority_support",
  ADVANCED_ANALYTICS: "advanced_analytics",
  CUSTOM_BRANDING: "custom_branding",
  SSO: "sso",
} as const;
export type Feature = (typeof FEATURES)[keyof typeof FEATURES];
