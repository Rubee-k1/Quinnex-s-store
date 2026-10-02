import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialFormState } from "./state";

const TOKEN = "a".repeat(43);
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  refresh: vi.fn(),
  existingToken: null as string | null,
  getOrCreate: vi.fn(),
}));

vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/cart-token", () => ({
  getCartToken: async () => mocks.existingToken,
  getOrCreateCartToken: mocks.getOrCreate,
}));

const { addToCart, removeCartItem, setCartItemQuantity } = await import("./cart");
const PRODUCT = "3f0c7d3e-2a59-4c51-9a3e-6c3f7d1d2b10";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.refresh.mockReset();
  mocks.getOrCreate.mockReset().mockResolvedValue(TOKEN);
  mocks.existingToken = TOKEN;
});

describe("addToCart", () => {
  it("adds via add_to_cart with the visitor's token and refreshes the UI", async () => {
    mocks.rpc.mockResolvedValue({ data: 3, error: null });
    const state = await addToCart(initialFormState, form({ productId: PRODUCT, quantity: "2" }));
    expect(mocks.getOrCreate).toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("add_to_cart", { p_token: TOKEN, p_product_id: PRODUCT, p_quantity: 2 });
    expect(state).toEqual({ status: "success", message: "Added to cart (3 in cart)." });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("rejects invalid product ids and quantities before touching the database or cookies", async () => {
    expect(await addToCart(initialFormState, form({ productId: "not-a-uuid" }))).toEqual({ status: "error", message: "Invalid product." });
    expect((await addToCart(initialFormState, form({ productId: PRODUCT, quantity: "500" }))).status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.getOrCreate).not.toHaveBeenCalled();
  });

  it("maps database errors to friendly messages and does not refresh", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "OUT_OF_STOCK" } });
    expect(await addToCart(initialFormState, form({ productId: PRODUCT }))).toEqual({
      status: "error",
      message: "Sorry, this product is out of stock.",
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("setCartItemQuantity", () => {
  it("updates the quantity via set_cart_item_quantity", async () => {
    mocks.rpc.mockResolvedValue({ data: 4, error: null });
    const state = await setCartItemQuantity(initialFormState, form({ productId: PRODUCT, quantity: "4" }));
    expect(state.status).toBe("success");
    expect(mocks.rpc).toHaveBeenCalledWith("set_cart_item_quantity", { p_token: TOKEN, p_product_id: PRODUCT, p_quantity: 4 });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("reports stock limits", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "INSUFFICIENT_STOCK" } });
    const state = await setCartItemQuantity(initialFormState, form({ productId: PRODUCT, quantity: "9" }));
    expect(state).toEqual({ status: "error", message: "Sorry, there isn't enough stock for that quantity." });
  });

  it("rejects zero and fractional quantities", async () => {
    expect((await setCartItemQuantity(initialFormState, form({ productId: PRODUCT, quantity: "0" }))).status).toBe("error");
    expect((await setCartItemQuantity(initialFormState, form({ productId: PRODUCT, quantity: "1.5" }))).status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not create a cart when there is none", async () => {
    mocks.existingToken = null;
    const state = await setCartItemQuantity(initialFormState, form({ productId: PRODUCT, quantity: "2" }));
    expect(state.status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("removeCartItem", () => {
  it("removes via remove_cart_item", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await removeCartItem(initialFormState, form({ productId: PRODUCT }))).status).toBe("success");
    expect(mocks.rpc).toHaveBeenCalledWith("remove_cart_item", { p_token: TOKEN, p_product_id: PRODUCT });
  });

  it("is a no-op without a cart", async () => {
    mocks.existingToken = null;
    expect((await removeCartItem(initialFormState, form({ productId: PRODUCT }))).status).toBe("success");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
