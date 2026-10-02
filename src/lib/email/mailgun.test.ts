import { describe, expect, it, vi } from "vitest";
import type { MailgunConfig } from "@/lib/env.server";
import { MailgunError, sendMailgunEmail } from "./mailgun";

const config: MailgunConfig = {
  apiKey: "test-mailgun-key-not-real-0003",
  domain: "mg.quinnex.com",
  from: "Quinnex Store <orders@mg.quinnex.com>",
  supportEmail: "help@quinnex.com",
  baseUrl: "https://api.eu.mailgun.net",
};
const message = { to: "ada@example.com", subject: "Hi", text: "Hello", html: "<p>Hello</p>", tags: ["order-confirmation"], headers: { "Reply-To": "help@quinnex.com" } };

describe("sendMailgunEmail", () => {
  it("POSTs a form-encoded message to the Mailgun API with basic auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "<abc@mg>", message: "Queued" }), { status: 200 }));
    expect(await sendMailgunEmail(config, message, fetchMock)).toEqual({ id: "<abc@mg>" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.eu.mailgun.net/v3/mg.quinnex.com/messages");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("api:test-mailgun-key-not-real-0003").toString("base64")}`);
    const body = init.body as URLSearchParams;
    expect(Object.fromEntries(body)).toMatchObject({
      from: "Quinnex Store <orders@mg.quinnex.com>",
      to: "ada@example.com",
      subject: "Hi",
      text: "Hello",
      html: "<p>Hello</p>",
      "o:tag": "order-confirmation",
      "h:Reply-To": "help@quinnex.com",
    });
    expect(body.toString()).not.toContain("test-mailgun-key-not-real-0003");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("explains authentication failures (wrong API key)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 401 }));
    const err = await sendMailgunEmail(config, message, fetchMock).catch((e) => e);
    expect(err).toBeInstanceOf(MailgunError);
    expect(err).toMatchObject({ status: 401, message: "Mailgun responded 401 (check MAILGUN_API_KEY): Forbidden" });
  });

  it("explains unknown domains and server errors", async () => {
    const notFound = vi.fn().mockResolvedValue(new Response('{"message":"Domain not found"}', { status: 404 }));
    await expect(sendMailgunEmail(config, message, notFound)).rejects.toThrow(/404 \(check MAILGUN_DOMAIN and region\)/);
    const down = vi.fn().mockResolvedValue(new Response("bad gateway", { status: 502 }));
    await expect(sendMailgunEmail(config, message, down)).rejects.toMatchObject({ status: 502 });
  });

  it("wraps network errors and timeouts", async () => {
    await expect(sendMailgunEmail(config, message, vi.fn().mockRejectedValue(new TypeError("fetch failed")))).rejects.toThrow(
      "Mailgun request failed: fetch failed",
    );
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    await expect(sendMailgunEmail(config, message, vi.fn().mockRejectedValue(timeout))).rejects.toThrow("timed out after 10s");
  });
});
