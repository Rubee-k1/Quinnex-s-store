import "server-only";
import type { MailgunConfig } from "@/lib/env.server";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  tags?: string[];
  /** Extra headers, e.g. Reply-To. */
  headers?: Record<string, string>;
};

export class MailgunError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MailgunError";
  }
}

const TIMEOUT_MS = 10_000;

/**
 * Sends an email through the Mailgun HTTP API (server only: the API key
 * travels only in the Authorization header of this server-to-server request).
 * Throws MailgunError on any failure.
 */
export async function sendMailgunEmail(
  config: MailgunConfig,
  message: EmailMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string }> {
  const body = new URLSearchParams();
  body.set("from", config.from);
  body.set("to", message.to);
  body.set("subject", message.subject);
  body.set("text", message.text);
  body.set("html", message.html);
  for (const tag of message.tags ?? []) body.append("o:tag", tag);
  for (const [name, value] of Object.entries(message.headers ?? {})) body.set(`h:${name}`, value);

  const url = `${config.baseUrl}/v3/${encodeURIComponent(config.domain)}/messages`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const reason = (err as Error).name === "TimeoutError" ? `timed out after ${TIMEOUT_MS / 1000}s` : (err as Error).message;
    throw new MailgunError(`Mailgun request failed: ${reason}`);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    const hint =
      res.status === 401 ? " (check MAILGUN_API_KEY)" : res.status === 404 ? " (check MAILGUN_DOMAIN and region)" : "";
    throw new MailgunError(`Mailgun responded ${res.status}${hint}: ${detail}`, res.status);
  }

  const json = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: json.id ?? "" };
}
