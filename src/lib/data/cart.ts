import "server-only";
import { getCartToken } from "@/lib/cart-token";
import { createClient } from "@/lib/supabase/server";
import type { CartRow } from "@/lib/types/database";

export type CartLine = CartRow & {
  lineTotalCents: number;
  /** The highest quantity the shopper may select right now. */
  maxQuantity: number;
  issue: "unavailable" | "insufficient_stock" | null;
};

export type Cart = {
  lines: CartLine[];
  itemCount: number;
  subtotalCents: number;
  currency: string | null;
  hasIssues: boolean;
};

export const EMPTY_CART: Cart = { lines: [], itemCount: 0, subtotalCents: 0, currency: null, hasIssues: false };

export function buildCart(rows: CartRow[]): Cart {
  const lines: CartLine[] = rows.map((row) => ({
    ...row,
    lineTotalCents: row.price_cents * row.quantity,
    maxQuantity: Math.min(99, Math.max(row.stock, row.quantity)),
    issue: !row.is_active ? "unavailable" : row.stock < row.quantity ? "insufficient_stock" : null,
  }));
  const purchasable = lines.filter((l) => l.issue !== "unavailable");
  return {
    lines,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    subtotalCents: purchasable.reduce((n, l) => n + l.lineTotalCents, 0),
    currency: purchasable[0]?.currency ?? null,
    hasIssues: lines.some((l) => l.issue !== null),
  };
}

/** Loads the visitor's cart (identified by the cart cookie) from Supabase. */
export async function getCart(): Promise<Cart> {
  const token = await getCartToken();
  if (!token) return EMPTY_CART;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_cart", { p_token: token });
  if (error) throw new Error(`Failed to load cart: ${error.message}`);
  return buildCart(data ?? []);
}
