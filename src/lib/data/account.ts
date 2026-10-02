import "server-only";
import { createClient } from "@/lib/supabase/server";

export type AccountOrder = {
  id: string;
  order_number: number;
  status: string;
  currency: string;
  total_cents: number;
  created_at: string;
  itemCount: number;
};

export type Profile = { id: string; email: string | null; full_name: string | null; avatar_url: string | null };

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  return data;
}

/**
 * The signed-in user's orders. Row Level Security restricts rows to
 * user_id = auth.uid(); no filter here could widen that.
 */
export async function listMyOrders(): Promise<AccountOrder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, status, currency, total_cents, created_at, items:order_items(quantity)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Failed to load orders: ${error.message}`);
  return data.map(({ items, ...o }) => ({ ...o, itemCount: items.reduce((n, i) => n + i.quantity, 0) }));
}
