import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name)! } : undefined),
    set: (name: string, value: string, options: unknown) => {
      jar.values.set(name, value);
      jar.set(name, value, options);
    },
  }),
}));

const { CART_COOKIE, generateCartToken, getCartToken, getOrCreateCartToken, isValidCartToken } = await import("./cart-token");

describe("cart token", () => {
  beforeEach(() => {
    jar.values.clear();
    jar.set.mockClear();
  });

  it("generates unique 256-bit base64url tokens", () => {
    const a = generateCartToken();
    expect(isValidCartToken(a)).toBe(true);
    expect(a).toHaveLength(43);
    expect(generateCartToken()).not.toBe(a);
  });

  it("ignores missing or tampered cookies", async () => {
    expect(await getCartToken()).toBeNull();
    jar.values.set(CART_COOKIE, "tampered<script>");
    expect(await getCartToken()).toBeNull();
  });

  it("issues a new httpOnly cookie when none exists", async () => {
    const token = await getOrCreateCartToken();
    expect(isValidCartToken(token)).toBe(true);
    expect(jar.set).toHaveBeenCalledWith(
      CART_COOKIE,
      token,
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 2592000 }),
    );
  });

  it("reuses and refreshes an existing valid cookie", async () => {
    const existing = generateCartToken();
    jar.values.set(CART_COOKIE, existing);
    expect(await getOrCreateCartToken()).toBe(existing);
    expect(jar.set).toHaveBeenCalledWith(CART_COOKIE, existing, expect.anything());
  });

  it("replaces an invalid cookie with a fresh token", async () => {
    jar.values.set(CART_COOKIE, "bad");
    const token = await getOrCreateCartToken();
    expect(token).not.toBe("bad");
    expect(isValidCartToken(token)).toBe(true);
  });
});
