// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const placeOrder = vi.hoisted(() => vi.fn());
vi.mock("@/actions/checkout", () => ({ placeOrder }));

const { CheckoutForm } = await import("./checkout-form");

describe("CheckoutForm", () => {
  it("submits the idempotency key and fingerprint, and shows field errors with values preserved", async () => {
    placeOrder.mockResolvedValue({
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { postalCode: "Postal code is required" },
      values: { email: "ada@example.com", name: "Ada Lovelace", line1: "1 Marina Road", city: "Lagos", country: "NG" },
    });
    render(
      <CheckoutForm
        idempotencyKey="3f0c7d3e-2a59-4c51-9a3e-6c3f7d1d2b10"
        cartFingerprint="0123456789abcdef0123456789abcdef"
        countries={[{ code: "NG", name: "Nigeria" }]}
      />,
    );
    await userEvent.type(screen.getByLabelText(/Full name/), "Ada Lovelace");
    await userEvent.click(screen.getByRole("button", { name: "Place order" }));

    expect(await screen.findByText("Please fix the highlighted fields.")).toBeInTheDocument();
    expect(screen.getByText("Postal code is required")).toBeInTheDocument();
    expect(screen.getByLabelText(/Postal code/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Full name/)).toHaveValue("Ada Lovelace");

    const submitted = placeOrder.mock.calls[0][1] as FormData;
    expect(submitted.get("idempotencyKey")).toBe("3f0c7d3e-2a59-4c51-9a3e-6c3f7d1d2b10");
    expect(submitted.get("cartFingerprint")).toBe("0123456789abcdef0123456789abcdef");
    expect([...submitted.keys()].some((k) => /price|total/i.test(k))).toBe(false);
  });

  it("explains an expired checkout session instead of pointing at hidden fields", async () => {
    placeOrder.mockResolvedValue({
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { cartFingerprint: "Your checkout session expired. Please reload the page." },
    });
    render(<CheckoutForm idempotencyKey="3f0c7d3e-2a59-4c51-9a3e-6c3f7d1d2b10" cartFingerprint="0123456789abcdef0123456789abcdef" countries={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Place order" }));
    expect(await screen.findByText("Your checkout session expired. Please reload the page.")).toBeInTheDocument();
    expect(screen.queryByText("Please fix the highlighted fields.")).not.toBeInTheDocument();
  });

  it("shows a failed-checkout message with a link back to the cart", async () => {
    placeOrder.mockResolvedValue({ status: "error", message: "Not enough stock for Minimal Desk Lamp (2 available)." });
    render(<CheckoutForm idempotencyKey="3f0c7d3e-2a59-4c51-9a3e-6c3f7d1d2b10" cartFingerprint="0123456789abcdef0123456789abcdef" countries={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Place order" }));
    expect(await screen.findByText("We couldn't place your order.")).toBeInTheDocument();
    expect(screen.getByText(/Not enough stock for Minimal Desk Lamp/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review your cart" })).toHaveAttribute("href", "/cart");
  });
});
