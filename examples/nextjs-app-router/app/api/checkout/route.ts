import { NextRequest, NextResponse } from "next/server";
import { billing } from "@/lib/billing";

/**
 * POST /api/checkout
 *
 * Creates a Stripe checkout session for the given price.
 *
 * Request body:
 * {
 *   "priceId": "price_xxx",      // Stripe price ID
 *   "userId": "user_123",        // Your user ID (stored in metadata)
 *   "email": "user@example.com"  // Optional: pre-fill email
 * }
 *
 * Response:
 * {
 *   "url": "https://checkout.stripe.com/..."
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { priceId, userId, email } = body;

    if (!priceId || !userId) {
      return NextResponse.json(
        { error: "Missing priceId or userId" },
        { status: 400 }
      );
    }

    // Get the base URL for success/cancel redirects
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    // Create checkout session using billing-sdk
    const checkout = await billing.createCheckout({
      priceId,
      customerRef: userId, // This gets stored in subscription metadata
      email,
      successUrl: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/billing/cancel`,
    });

    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    console.error("Checkout error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
