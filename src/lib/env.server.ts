import "server-only";
import { z } from "zod";
import { STORE_NAME } from "./store";

/**
 * Server-only configuration. This module must never be imported by client
 * components; `server-only` makes the build fail if it is.
 */

export type MailgunConfig = {
  apiKey: string;
  domain: string;
  /** RFC 5322 "Name <address>" used as the From header. */
  from: string;
  /** Plain address used as the support contact in emails. */
  supportEmail: string;
  baseUrl: string;
};

export type MailgunConfigResult = { ok: true; config: MailgunConfig } | { ok: false; error: string };

const emailAddress = z.email();
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](-*[a-z0-9])*\.)+[a-z]{2,63}$/i;

/** Accepts "orders@mg.example.com" or "Quinnex Store <orders@mg.example.com>". */
function parseFrom(value: string): { header: string; address: string } | null {
  const named = value.match(/^\s*"?([^"<>]*?)"?\s*<([^<>\s]+)>\s*$/);
  const address = (named ? named[2] : value).trim();
  if (!emailAddress.safeParse(address).success) return null;
  const name = named?.[1].trim() || STORE_NAME;
  return { header: `${name.replace(/[\r\n"]/g, "")} <${address}>`, address };
}

/**
 * Reads and validates the Mailgun settings. Never throws, and never includes
 * the API key in error messages.
 */
export function getMailgunConfig(env: NodeJS.ProcessEnv = process.env): MailgunConfigResult {
  const apiKey = env.MAILGUN_API_KEY?.trim();
  const domain = env.MAILGUN_DOMAIN?.trim();
  const fromRaw = env.MAILGUN_FROM_EMAIL?.trim();

  const missing = [!apiKey && "MAILGUN_API_KEY", !domain && "MAILGUN_DOMAIN", !fromRaw && "MAILGUN_FROM_EMAIL"].filter(Boolean);
  if (missing.length) return { ok: false, error: `Mailgun is not configured: missing ${missing.join(", ")}` };

  if (/\s/.test(apiKey!) || apiKey!.length < 10) return { ok: false, error: "Invalid Mailgun configuration: MAILGUN_API_KEY is malformed" };
  if (!DOMAIN.test(domain!)) return { ok: false, error: "Invalid Mailgun configuration: MAILGUN_DOMAIN is not a valid domain" };
  const from = parseFrom(fromRaw!);
  if (!from) return { ok: false, error: "Invalid Mailgun configuration: MAILGUN_FROM_EMAIL is not a valid email address" };

  const supportRaw = env.STORE_SUPPORT_EMAIL?.trim();
  if (supportRaw && !emailAddress.safeParse(supportRaw).success) {
    return { ok: false, error: "Invalid configuration: STORE_SUPPORT_EMAIL is not a valid email address" };
  }

  // EU-region Mailgun domains use https://api.eu.mailgun.net.
  const baseRaw = env.MAILGUN_API_BASE_URL?.trim() || "https://api.mailgun.net";
  let baseUrl: string;
  try {
    const u = new URL(baseRaw);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) throw new Error();
    baseUrl = u.origin;
  } catch {
    return { ok: false, error: "Invalid Mailgun configuration: MAILGUN_API_BASE_URL must be an https URL" };
  }

  return {
    ok: true,
    config: { apiKey: apiKey!, domain: domain!.toLowerCase(), from: from.header, supportEmail: supportRaw || from.address, baseUrl },
  };
}

/** Absolute public URL of the shop, for links in emails. */
export function getSiteUrl(env: NodeJS.ProcessEnv = process.env) {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return "http://localhost:3000";
}
