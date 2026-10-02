import "server-only";
import { getCartToken } from "@/lib/cart-token";
import { createClient } from "@/lib/supabase/server";
import type { Order } from "@/lib/types/database";

/**
 * Loads an order for the current visitor. The database only returns it to the
 * browser (cart cookie) that placed it; anything else yields null.
 */
export async function getOrderForVisitor(orderId: string): Promise<Order | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) return null;
  const token = await getCartToken();
  if (!token) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_order", { p_token: token, p_order_id: orderId });
  if (error) throw new Error(`Failed to load order: ${error.message}`);
  return (data as Order | null) ?? null;
}

/** Digest of the visitor's current cart, used to detect changes before ordering. */
export async function getCartFingerprint(token: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_cart_fingerprint", { p_token: token });
  if (error || !data) throw new Error(`Failed to prepare checkout: ${error?.message ?? "no fingerprint"}`);
  return data;
}
