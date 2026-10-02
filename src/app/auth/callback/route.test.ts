import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  rpc: vi.fn(),
  token: null as string | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: mocks.exchange }, rpc: mocks.rpc }),
}));
vi.mock("@/lib/cart-token", () => ({ getCartToken: async () => mocks.token }));

const { GET } = await import("./route");
const call = async (query: string) => {
  const res = await GET(new NextRequest(`https://shop.example/auth/callback${query}`));
  return { status: res.status, location: res.headers.get("location") };
};

beforeEach(() => {
  mocks.exchange.mockReset().mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: 0, error: null });
  mocks.token = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /auth/callback", () => {
  it("exchanges the code for a session and returns to the requested page", async () => {
    expect(await call("?code=abc&next=%2Faccount")).toEqual({ status: 307, location: "https://shop.example/account" });
    expect(mocks.exchange).toHaveBeenCalledWith("abc");
  });

  it("links guest orders from this browser after signing in", async () => {
    mocks.token = "t".repeat(43);
    await call("?code=abc");
    expect(mocks.rpc).toHaveBeenCalledWith("link_guest_orders_to_user", { p_token: mocks.token });
  });

  it("still signs in if linking guest orders fails", async () => {
    mocks.token = "t".repeat(43);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await call("?code=abc")).location).toBe("https://shop.example/");
  });

  it("maps a cancelled Google consent to access_denied", async () => {
    expect((await call("?error=access_denied&error_description=User+cancelled&next=%2Faccount")).location).toBe(
      "https://shop.example/login?error=access_denied&next=%2Faccount",
    );
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("maps other provider errors to a generic callback error", async () => {
    expect((await call("?error=server_error")).location).toBe("https://shop.example/login?error=callback&next=%2F");
  });

  it("rejects a missing code", async () => {
    expect((await call("")).location).toBe("https://shop.example/login?error=missing_code&next=%2F");
  });

  it("reports a failed code exchange (expired / reused / wrong verifier)", async () => {
    mocks.exchange.mockResolvedValue({ data: { session: null }, error: { message: "invalid flow state" } });
    expect((await call("?code=used")).location).toBe("https://shop.example/login?error=callback&next=%2F");
  });

  it("never redirects off-site", async () => {
    expect((await call("?code=abc&next=https%3A%2F%2Fevil.example")).location).toBe("https://shop.example/");
    expect((await call("?code=abc&next=%2F%2Fevil.example")).location).toBe("https://shop.example/");
  });
});
