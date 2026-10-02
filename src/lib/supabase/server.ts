import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/env";
import type { Database } from "@/lib/types/database";

/**
 * Server-side Supabase client bound to the current request.
 *
 * Uses the public anon key plus the visitor's Supabase Auth session (stored in
 * cookies by @supabase/ssr). Queries run as the signed-in user — or anonymously
 * — with Row Level Security enforced. No service-role key is used anywhere.
 * Create one per request; never share across requests.
 */
export async function createClient() {
  // Stock, prices and the session must be read per request, never prerendered.
  await connection();
  const { url, anonKey } = getPublicSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // proxy refreshes the session on every request, so this is safe.
        }
      },
    },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}
