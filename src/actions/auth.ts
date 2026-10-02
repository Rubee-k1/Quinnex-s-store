"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRequestOrigin } from "@/lib/request-origin";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Starts Supabase Auth's Google OAuth flow (PKCE). Supabase stores the PKCE
 * verifier in a cookie and returns Google's consent URL; after consent Google
 * returns to Supabase, which redirects to /auth/callback with a one-time code.
 */
export async function signInWithGoogle(formData: FormData) {
  const next = safeRedirectPath(formData.get("next"));
  const origin = await getRequestOrigin();
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: { prompt: "select_account" },
    },
  });

  if (error || !data?.url) {
    console.error("[auth] could not start Google sign-in:", error?.message ?? "no URL returned");
    redirect(`/login?error=oauth_start&next=${encodeURIComponent(next)}`);
  }
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) console.error("[auth] sign-out error:", error.message);
  revalidatePath("/", "layout");
  redirect("/");
}
