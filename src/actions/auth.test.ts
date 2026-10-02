import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/request-origin", () => ({ getRequestOrigin: async () => "https://shop.example" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithOAuth: mocks.signInWithOAuth, signOut: mocks.signOut } }),
}));

const { signInWithGoogle, signOut } = await import("./auth");
const form = (next?: string) => {
  const fd = new FormData();
  if (next !== undefined) fd.set("next", next);
  return fd;
};
const redirectOf = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as { url?: string }).url;

beforeEach(() => {
  mocks.signInWithOAuth.mockReset();
  mocks.signOut.mockReset().mockResolvedValue({ error: null });
  mocks.revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("signInWithGoogle", () => {
  it("uses Supabase Auth's Google provider and redirects to the consent URL", async () => {
    mocks.signInWithOAuth.mockResolvedValue({ data: { url: "https://project.supabase.co/auth/v1/authorize?provider=google" }, error: null });
    expect(await redirectOf(signInWithGoogle(form("/account")))).toBe("https://project.supabase.co/auth/v1/authorize?provider=google");
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://shop.example/auth/callback?next=%2Faccount", queryParams: { prompt: "select_account" } },
    });
  });

  it("sanitises the return path", async () => {
    mocks.signInWithOAuth.mockResolvedValue({ data: { url: "https://x" }, error: null });
    await signInWithGoogle(form("https://evil.example")).catch(() => {});
    expect(mocks.signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe("https://shop.example/auth/callback?next=%2F");
  });

  it("shows an error state when the provider can't be started (e.g. not enabled)", async () => {
    mocks.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: "Unsupported provider: provider is not enabled" } });
    expect(await redirectOf(signInWithGoogle(form("/account")))).toBe("/login?error=oauth_start&next=%2Faccount");
  });
});

describe("signOut", () => {
  it("ends the Supabase session and returns home", async () => {
    expect(await redirectOf(signOut())).toBe("/");
    expect(mocks.signOut).toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
