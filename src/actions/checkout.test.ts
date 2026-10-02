import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialFormState } from "./state";

const TOKEN = "a".repeat(43);
const KEY = "3f0c7d3e-2a59-4c51-9a3e-6c3f7d1d2b10";
const FINGERPRINT = "0123456789abcdef0123456789abcdef";
const ORDER_ID = "9a0c7d3e-2a59-4c51-9a3e-6c3f7d1d2b10";

const mocks = vi.hoisted(() => ({
  token: null as string | null,
  rpc: vi.fn(),
  refresh: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ refresh: mocks.refresh, revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/cart-token", () => ({ getCartToken: async () => mocks.token }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));

const { placeOrder } = await import("./checkout");

function form(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const values: Record<string, string> = {
    idempotencyKey: KEY,
    cartFingerprint: FINGERPRINT,
    email: " Ada@Example.com ",
    name: "Ada Lovelace",
    line1: "1 Marina Road",
    city: "Lagos",
    postalCode: "100001",
    country: "ng",
    // Tampering attempts: none of these may reach the database.
    total: "1",
    subtotal_cents: "1",
    price: "0",
    "items[0][price]": "1",
    ...overrides,
  };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

async function run(fd: FormData) {
  try {
    return { state: await placeOrder(initialFormState, fd), redirectedTo: null as string | null };
  } catch (err) {
    const url = (err as { url?: string }).url;
    if (url) return { state: null, redirectedTo: url };
    throw err;
  }
}

beforeEach(() => {
  mocks.token = TOKEN;
  mocks.rpc.mockReset();
  mocks.refresh.mockReset();
  mocks.revalidatePath.mockReset();
});

describe("placeOrder", () => {
  it("places the order via place_order and redirects to the confirmation page", async () => {
    mocks.rpc.mockResolvedValue({ data: ORDER_ID, error: null });
    const { redirectedTo } = await run(form());
    expect(mocks.rpc).toHaveBeenCalledWith("place_order", {
      p_token: TOKEN,
      p_idempotency_key: KEY,
      p_expected_fingerprint: FINGERPRINT,
      p_customer: {
        email: "ada@example.com",
        name: "Ada Lovelace",
        phone: null,
        line1: "1 Marina Road",
        line2: null,
        city: "Lagos",
        state: null,
        postal_code: "100001",
        country: "NG",
      },
    });
    expect(redirectedTo).toBe(`/orders/${ORDER_ID}?placed=1`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("never sends prices, totals or quantities from the browser", async () => {
    mocks.rpc.mockResolvedValue({ data: ORDER_ID, error: null });
    await run(form());
    expect(JSON.stringify(mocks.rpc.mock.calls[0][1])).not.toMatch(/price|total|subtotal|quantity|items/i);
  });

  it("returns field errors and does not call the database for invalid details", async () => {
    const { state } = await run(form({ email: "bad", postalCode: "" }));
    expect(state).toMatchObject({
      status: "error",
      fieldErrors: { email: "Enter a valid email address", postalCode: "Postal code is required" },
    });
    expect(state?.values?.name).toBe("Ada Lovelace");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing idempotency key or fingerprint", async () => {
    expect((await run(form({ idempotencyKey: "" }))).state?.fieldErrors?.idempotencyKey).toMatch(/expired/);
    expect((await run(form({ cartFingerprint: "x" }))).state?.fieldErrors?.cartFingerprint).toMatch(/expired/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reports an empty cart when the visitor has no cart", async () => {
    mocks.token = null;
    const { state } = await run(form());
    expect(state).toMatchObject({ status: "error", message: "Your cart is empty." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["CART_EMPTY", "Your cart is empty."],
    ["INSUFFICIENT_STOCK: Minimal Desk Lamp (2 available)", "Not enough stock for Minimal Desk Lamp (2 available). Please update the quantity in your cart."],
    ["PRODUCT_UNAVAILABLE: Merino Wool Beanie", "Merino Wool Beanie is no longer available. Please remove it from your cart."],
  ])("maps %s to a failed-checkout message and keeps it on screen", async (dbMessage, userMessage) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: dbMessage } });
    const { state, redirectedTo } = await run(form());
    expect(redirectedTo).toBeNull();
    expect(state).toMatchObject({ status: "error", message: userMessage });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("refreshes the order summary when the cart changed after checkout was opened", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "CART_CHANGED" } });
    const { state } = await run(form());
    expect(state?.message).toBe("Your cart changed since you opened checkout. Please review the updated order summary and try again.");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("hides unexpected database errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'relation "orders" does not exist' } });
    const { state } = await run(form());
    expect(state?.message).toBe("Something went wrong. Please try again.");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
