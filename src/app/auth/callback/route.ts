import { NextResponse, type NextRequest } from "next/server";
import { getCartToken } from "@/lib/cart-token";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth return URL. Supabase Auth redirects here after Google consent with a
 * one-time `code` (PKCE), or with `error` if the user cancelled / it failed.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeRedirectPath(searchParams.get("next"));
  const fail = (code: string) => {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", code);
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  };

  const oauthError = searchParams.get("error");
  if (oauthError) {
    console.error("[auth/callback] provider error:", oauthError, searchParams.get("error_description") ?? "");
    return fail(oauthError === "access_denied" ? "access_denied" : "callback");
  }

  const code = searchParams.get("code");
  if (!code) return fail("missing_code");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    console.error("[auth/callback] code exchange failed:", error?.message);
    return fail("callback");
  }

  // Attach guest orders placed in this browser with the same email address.
  const cartToken = await getCartToken();
  if (cartToken) {
    const { error: linkError } = await supabase.rpc("link_guest_orders_to_user", { p_token: cartToken });
    if (linkError) console.error("[auth/callback] could not link guest orders:", linkError.message);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
