import { describe, expect, it } from "vitest";
import { getMailgunConfig, getSupportEmail } from "./env.server";

const KEY = "test-mailgun-key-not-real-0001";
const base = { MAILGUN_API_KEY: KEY, MAILGUN_DOMAIN: "mg.quinnex.com", MAILGUN_FROM_EMAIL: "orders@mg.quinnex.com" };
const cfg = (env: Record<string, string | undefined>) => getMailgunConfig(env as NodeJS.ProcessEnv);

describe("getMailgunConfig", () => {
  it("accepts a valid configuration and builds a From header with the shop name", () => {
    expect(cfg(base)).toEqual({
      ok: true,
      config: {
        apiKey: KEY,
        domain: "mg.quinnex.com",
        from: "Quinnex Store <orders@mg.quinnex.com>",
        supportEmail: "orders@mg.quinnex.com",
        baseUrl: "https://api.mailgun.net",
      },
    });
  });

  it("keeps a display name, supports EU region and a separate support address", () => {
    const r = cfg({ ...base, MAILGUN_FROM_EMAIL: "Quinnex Orders <orders@mg.quinnex.com>", MAILGUN_API_BASE_URL: "https://api.eu.mailgun.net/", STORE_SUPPORT_EMAIL: "help@quinnex.com" });
    expect(r).toMatchObject({ ok: true, config: { from: "Quinnex Orders <orders@mg.quinnex.com>", baseUrl: "https://api.eu.mailgun.net", supportEmail: "help@quinnex.com" } });
  });

  it("reports every missing variable", () => {
    expect(cfg({})).toEqual({ ok: false, error: "Mailgun is not configured: missing MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_FROM_EMAIL" });
    expect(cfg({ ...base, MAILGUN_DOMAIN: "  " })).toEqual({ ok: false, error: "Mailgun is not configured: missing MAILGUN_DOMAIN" });
  });

  it.each([
    [{ MAILGUN_API_KEY: "short" }, /MAILGUN_API_KEY is malformed/],
    [{ MAILGUN_API_KEY: "key with spaces 12345" }, /MAILGUN_API_KEY is malformed/],
    [{ MAILGUN_DOMAIN: "https://mg.quinnex.com" }, /MAILGUN_DOMAIN is not a valid domain/],
    [{ MAILGUN_DOMAIN: "localhost" }, /MAILGUN_DOMAIN is not a valid domain/],
    [{ MAILGUN_FROM_EMAIL: "not-an-email" }, /MAILGUN_FROM_EMAIL is not a valid email/],
    [{ MAILGUN_FROM_EMAIL: "Name <bad>" }, /MAILGUN_FROM_EMAIL is not a valid email/],
    [{ STORE_SUPPORT_EMAIL: "nope" }, /STORE_SUPPORT_EMAIL is not a valid email/],
    [{ MAILGUN_API_BASE_URL: "http://api.mailgun.net" }, /must be an https URL/],
    [{ MAILGUN_API_BASE_URL: "not a url" }, /must be an https URL/],
  ])("rejects invalid configuration %o", (override, message) => {
    const r = cfg({ ...base, ...override });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(message);
      expect(r.error).not.toContain(KEY);
    }
  });

  it("strips header-injection characters from the display name", () => {
    const r = cfg({ ...base, MAILGUN_FROM_EMAIL: '"Evil\r\nBcc: x@y.z" <orders@mg.quinnex.com>' });
    expect(r.ok && r.config.from).not.toMatch(/[\r\n]/);
  });
});

describe("getSupportEmail", () => {
  const support = (env: Record<string, string | undefined>) => getSupportEmail(env as NodeJS.ProcessEnv);

  it("prefers STORE_SUPPORT_EMAIL, then the From address, otherwise null", () => {
    expect(support({ STORE_SUPPORT_EMAIL: "help@quinnex.com", MAILGUN_FROM_EMAIL: "orders@mg.quinnex.com" })).toBe("help@quinnex.com");
    expect(support({ MAILGUN_FROM_EMAIL: "Quinnex <orders@mg.quinnex.com>" })).toBe("orders@mg.quinnex.com");
    expect(support({ STORE_SUPPORT_EMAIL: "not-an-email", MAILGUN_FROM_EMAIL: "orders@mg.quinnex.com" })).toBe("orders@mg.quinnex.com");
    expect(support({})).toBeNull();
  });
});
