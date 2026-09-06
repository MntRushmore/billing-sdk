import type { Capabilities } from "../types.js";
export const STRIPE_CAPABILITIES = {
  webhookVerification: true,
  customerPortal: true,
  merchantOfRecord: false,
  usageBilling: true,
  proration: true,
  refunds: true,
} satisfies Capabilities;
export const POLAR_CAPABILITIES = {
  webhookVerification: true,
  customerPortal: true,
  merchantOfRecord: true,
  usageBilling: false,
  proration: false,
  refunds: true,
} satisfies Capabilities;
