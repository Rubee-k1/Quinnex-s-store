"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCartToken } from "@/lib/cart-token";
import { describeDbError } from "@/lib/db-errors";
import { sendOrderConfirmation } from "@/lib/email/send-order-confirmation";
import { createClient } from "@/lib/supabase/server";
import { CHECKOUT_FIELDS, checkoutSchema, fieldErrors, formValues } from "@/lib/validation";
import type { FormState } from "./state";


/**
 * Converts the visitor's cart into an order.
 *
 * Only customer details are taken from the form. Products, quantities, prices
 * and totals are read and recalculated by place_order() in the database, inside
 * one transaction. The form's idempotency key makes repeated submissions of the
 * same checkout return the same order instead of creating another.
 */
export async function placeOrder(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, CHECKOUT_FIELDS);
  const parsed = checkoutSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error), values };
  }
  const input = parsed.data;

  const token = await getCartToken();
  if (!token) return { status: "error", message: "Your cart is empty.", values };

  const supabase = await createClient();
  const { data: orderId, error } = await supabase.rpc("place_order", {
    p_token: token,
    p_idempotency_key: input.idempotencyKey,
    p_expected_fingerprint: input.cartFingerprint,
    p_customer: {
      email: input.email,
      name: input.name,
      phone: input.phone ?? null,
      line1: input.line1,
      line2: input.line2 ?? null,
      city: input.city,
      state: input.state ?? null,
      postal_code: input.postalCode,
      country: input.country,
    },
  });

  if (error || !orderId) {
    console.error("[checkout] place_order failed:", error?.message);
    // The summary on screen is stale: re-render it (with a new fingerprint) so the
    // shopper can review the current cart. Other failures keep the form and its
    // specific error message on screen, with a link back to the cart.
    if (error?.message?.includes("CART_CHANGED")) refresh();
    return { status: "error", message: describeDbError(error), values };
  }

  // The order is committed. Send the confirmation email; failures are recorded
  // on the order for retry and never undo or block the successful checkout.
  try {
    await sendOrderConfirmation(token, orderId);
  } catch (err) {
    console.error("[checkout] confirmation email error (order kept):", (err as Error).message);
  }

  revalidatePath("/", "layout"); // header cart count is now 0
  redirect(`/orders/${orderId}?placed=1`);
}

/** Customer-initiated retry of a failed confirmation email (limited attempts). */
export async function resendOrderConfirmation(_prev: FormState, formData: FormData): Promise<FormState> {
  const orderId = String(formData.get("orderId") ?? "");
  const token = await getCartToken();
  if (!token || !/^[0-9a-f-]{36}$/i.test(orderId)) return { status: "error", message: "Order not found." };

  const result = await sendOrderConfirmation(token, orderId);
  refresh();
  if (result.status === "sent") return { status: "success", message: "Confirmation email sent." };
  if (result.status === "skipped") return { status: "error", message: "This email can't be resent right now." };
  return { status: "error", message: "We still couldn't send the email. Please try again later or contact us." };
}
