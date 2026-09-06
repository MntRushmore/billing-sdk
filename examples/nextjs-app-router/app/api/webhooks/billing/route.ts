import { NextRequest, NextResponse } from "next/server";
import { billing } from "@/lib/billing";

/**
 * POST /api/webhooks/billing
 *
 * Handles Stripe webhooks. The billing-sdk:
 * 1. Verifies the webhook signature
 * 2. Parses into typed BillingEvent
 * 3. Auto-invalidates the entitlement cache
 *
 * Configure this URL in your Stripe Dashboard:
 * https://dashboard.stripe.com/webhooks
 */
export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const body = await request.text();

    // Get Stripe signature header
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return NextResponse.json(
        { error: "Missing stripe-signature header" },
        { status: 400 }
      );
    }

    // Process webhook with billing-sdk
    // This verifies signature, parses event, and invalidates cache
    const event = await billing.handleWebhook({
      body,
      headers: { "stripe-signature": signature },
      secret: process.env.STRIPE_WEBHOOK_SECRET!,
    });

    // Handle the normalized event
    switch (event.type) {
      case "subscription.started":
        console.log(`New subscription for ${event.customerRef}`);
        // TODO: Send welcome email, update user record, etc.
        // await db.user.update({
        //   where: { id: event.customerRef },
        //   data: { plan: "pro", subscribedAt: new Date() },
        // });
        break;

      case "subscription.renewed":
        console.log(`Subscription renewed for ${event.customerRef}`);
        // Entitlement is already updated, cache is invalidated
        // Usually no action needed
        break;

      case "subscription.canceled":
        console.log(`Subscription canceled for ${event.customerRef}`);
        // User still has access until event.entitlement.periodEnd
        // You might want to:
        // - Send "we're sorry to see you go" email
        // - Show a "reactivate" banner in the app
        console.log(`Access continues until: ${event.entitlement.periodEnd}`);
        break;

      case "subscription.ended":
        console.log(`Subscription ended for ${event.customerRef}`);
        // Access is now revoked
        // TODO: Downgrade user to free tier
        // await db.user.update({
        //   where: { id: event.customerRef },
        //   data: { plan: "free" },
        // });
        break;

      case "payment.succeeded":
        console.log(`Payment succeeded: ${event.amount} ${event.currency}`);
        // Optional: Record payment for your own analytics
        break;

      case "payment.failed":
        console.log(`Payment failed for ${event.customerRef}`);
        // TODO: Send payment failed email
        // await sendPaymentFailedEmail(event.customerRef);
        break;

      case "refund.issued":
        console.log(`Refund issued: ${event.amount} ${event.currency}`);
        break;

      case "unmapped":
        // Event we don't explicitly handle
        // Log it but don't fail - this is expected for many Stripe events
        console.log(`Unhandled event type: ${event.providerType}`);
        break;
    }

    // Always return 200 to acknowledge receipt
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);

    // Return 400 for signature verification failures
    // This tells Stripe to retry later
    if (error instanceof Error && error.message.includes("signature")) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}

// Disable body parsing - we need the raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};
