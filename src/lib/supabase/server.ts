import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/env";
import type { Database } from "@/lib/types/database";

/**
 * Server-side Supabase client using the public anon key. All access is
 * governed by RLS and the cart functions' token checks. Phase 1 has no user
 * sessions, so no auth cookies are read or written.
 */
// Awaiting connection() makes every page that reads from Supabase render per
// request (stock and prices must be live) instead of at build time.
export async function createClient() {
  await connection();
  const { url, anonKey } = getPublicSupabaseConfig();
  return createSupabaseClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}
