/**
 * Billing client setup for the application.
 *
 * This file shows how to configure @fuime/billing-sdk with:
 * - Stripe as the provider
 * - Entitlement caching (1 minute TTL)
 * - Feature gating per plan
 */

import { createEnhancedClient } from "@fuime/billing-sdk";
import { stripe } from "@fuime/billing-sdk/stripe";

// For production with multiple servers, use Redis:
// import { redisCache } from "@fuime/billing-sdk/cache/redis";
// import Redis from "ioredis";

/**
 * The billing client - use this throughout your app.
 *
 * Features:
 * - billing.getEntitlement(userId) - Check if user has access (cached)
 * - billing.hasFeature(userId, feature) - Check specific feature access
 * - billing.getFeatures(userId) - Get all features for a user
 * - billing.createCheckout(...) - Create a Stripe checkout session
 * - billing.handleWebhook(...) - Process Stripe webhooks
 */
export const billing = createEnhancedClient({
  provider: stripe({
    apiKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  }),

  // Cache entitlements for 1 minute to avoid hitting Stripe on every request
  cache: {
    ttlMs: 60_000, // 1 minute
    nullTtlMs: 10_000, // Cache "no subscription" for 10 seconds
  },

  // For multi-server deployments, use Redis instead:
  // cache: {
  //   adapter: redisCache({ client: new Redis(process.env.REDIS_URL!) }),
  //   ttlMs: 60_000,
  // },

  // Define what features each plan includes
  plans: {
    // Free tier (or no subscription)
    // Users get defaultFeatures below

    // Pro plan - $20/month
    [process.env.STRIPE_PRO_PRICE_ID!]: {
      features: ["basic_export", "csv_export", "api_access", "priority_support"],
    },

    // Enterprise plan - $99/month
    [process.env.STRIPE_ENTERPRISE_PRICE_ID!]: {
      features: "*", // All features
    },
  },

  // Features available to everyone (including free users)
  defaultFeatures: ["basic_export"],
});

/**
 * Helper to get the current user's ID.
 * In a real app, this would come from your auth system (Clerk, NextAuth, etc.)
 */
export function getCurrentUserId(): string | null {
  // TODO: Replace with your actual auth logic
  // Example with NextAuth:
  // const session = await getServerSession();
  // return session?.user?.id ?? null;

  // For demo purposes, we'll use a cookie or return null
  return null;
}

/**
 * Feature flags - use these in your app for type safety.
 */
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
