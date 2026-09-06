import type {
  BillingClient,
  BillingProvider,
  CreateBillingClientOptions,
} from "./types.js";

/**
 * Creates a billing client wrapping any provider.
 * The client is a thin pass-through with a typed native() escape hatch.
 */
export function createBillingClient(opts: CreateBillingClientOptions): BillingClient {
  const { provider } = opts;

  return {
    get name() {
      return provider.name;
    },
    get capabilities() {
      return provider.capabilities;
    },

    createCheckout: provider.createCheckout.bind(provider),
    handleWebhook: provider.handleWebhook.bind(provider),
    getEntitlement: provider.getEntitlement.bind(provider),

    // Optional methods: only present if provider supports them
    ...(provider.createPortalSession && {
      createPortalSession: provider.createPortalSession.bind(provider),
    }),
    ...(provider.refund && {
      refund: provider.refund.bind(provider),
    }),

    native<T>(): T {
      return provider.native as T;
    },
  };
}
