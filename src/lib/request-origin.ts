import "server-only";
import { headers } from "next/headers";

const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/**
 * Absolute origin of the current request, for OAuth redirect URLs. Uses
 * NEXT_PUBLIC_SITE_URL when set; otherwise the request host (so Vercel preview
 * deployments redirect back to themselves). Supabase only accepts redirect URLs
 * on its allow-list, so a spoofed Host header cannot redirect anywhere else.
 */
export async function getRequestOrigin(): Promise<string> {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || (host.startsWith("localhost") ? "http" : "https");
  if (!HOST.test(host) || !["http", "https"].includes(proto)) return "http://localhost:3000";
  return `${proto}://${host}`;
}
