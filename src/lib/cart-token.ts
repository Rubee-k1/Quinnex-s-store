import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export const CART_COOKIE = "qx_cart";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidCartToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** 256-bit random token, base64url (43 chars). Only its hash is stored in the DB. */
export function generateCartToken() {
  return randomBytes(32).toString("base64url");
}

/** Read the visitor's cart token, if any. Safe in Server Components. */
export async function getCartToken(): Promise<string | null> {
  const value = (await cookies()).get(CART_COOKIE)?.value;
  return isValidCartToken(value) ? value : null;
}

/**
 * Return the existing token or issue a new one. Sets/refreshes the cookie, so
 * this may only be called from a Server Action or Route Handler.
 */
export async function getOrCreateCartToken(): Promise<string> {
  const store = await cookies();
  const existing = store.get(CART_COOKIE)?.value;
  const token = isValidCartToken(existing) ? existing : generateCartToken();
  store.set(CART_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return token;
}
