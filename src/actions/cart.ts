"use server";

import { refresh } from "next/cache";
import { getCartToken, getOrCreateCartToken } from "@/lib/cart-token";
import { describeDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { cartItemSchema, productIdSchema, quantitySchema } from "@/lib/validation";
import type { FormState } from "./state";

export async function addToCart(_prev: FormState, formData: FormData): Promise<FormState> {
  const productId = productIdSchema.safeParse(formData.get("productId"));
  const quantity = quantitySchema.safeParse(formData.get("quantity") ?? 1);
  if (!productId.success) return { status: "error", message: "Invalid product." };
  if (!quantity.success) return { status: "error", message: quantity.error.issues[0].message };

  const token = await getOrCreateCartToken();
  const { data, error } = await (await createClient()).rpc("add_to_cart", {
    p_token: token,
    p_product_id: productId.data,
    p_quantity: quantity.data,
  });
  if (error) return { status: "error", message: describeDbError(error) };

  refresh(); // re-render the header cart count
  return { status: "success", message: `Added to cart (${data} in cart).` };
}

export async function setCartItemQuantity(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = cartItemSchema.safeParse({ productId: formData.get("productId"), quantity: formData.get("quantity") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0].message };

  const token = await getCartToken();
  if (!token) return { status: "error", message: "Your cart is empty." };

  const { error } = await (await createClient()).rpc("set_cart_item_quantity", {
    p_token: token,
    p_product_id: parsed.data.productId,
    p_quantity: parsed.data.quantity,
  });
  if (error) return { status: "error", message: describeDbError(error) };

  refresh();
  return { status: "success" };
}

export async function removeCartItem(_prev: FormState, formData: FormData): Promise<FormState> {
  const productId = productIdSchema.safeParse(formData.get("productId"));
  if (!productId.success) return { status: "error", message: "Invalid product." };

  const token = await getCartToken();
  if (!token) return { status: "success" };

  const { error } = await (await createClient()).rpc("remove_cart_item", { p_token: token, p_product_id: productId.data });
  if (error) return { status: "error", message: describeDbError(error) };

  refresh();
  return { status: "success" };
}
