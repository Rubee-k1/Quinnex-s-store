import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 2 checkout journeys against a live stack (app + Supabase with both
 * migrations and the seed applied).
 *
 * Optional: E2E_DATABASE_URL — a direct Postgres connection to the same
 * database. When set, the tests also verify persisted rows and simulate stock
 * or availability changes made by someone else mid-checkout.
 */
const DB_URL = process.env.E2E_DATABASE_URL;

async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    return (await c.query(query, params)).rows as T[];
  } finally {
    await c.end();
  }
}

const uniqueEmail = (tag: string) => `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.com`;

async function addToCart(page: Page, slug: string, quantity = 1) {
  await page.goto(`/products/${slug}`);
  if (quantity > 1) await page.getByLabel("Quantity").selectOption(String(quantity));
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText(/Added to cart \(\d+ in cart\)\./)).toBeVisible();
}

async function fillCheckout(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Full name/).fill("Ada Lovelace");
  await page.getByLabel(/^Address/).fill("1 Marina Road");
  await page.getByLabel(/City/).fill("Lagos");
  await page.getByLabel(/Postal code/).fill("100001");
  await page.getByLabel("Country").selectOption("NG");
}

const ordersFor = (email: string) =>
  sql<{ id: string; total_cents: number; subtotal_cents: number; status: string; user_id: string | null; n_items: number }>(
    `select o.id, o.total_cents, o.subtotal_cents, o.status, o.user_id,
            (select count(*)::int from order_items i where i.order_id = o.id) as n_items
     from orders o where o.email = $1`,
    [email],
  );

test.describe("checkout", () => {
  test("empty cart: checkout shows the empty state and the cart has no checkout button", async ({ page }) => {
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Place order" })).toHaveCount(0);
    await page.goto("/cart");
    await expect(page.getByRole("link", { name: "Checkout" })).toHaveCount(0);
  });

  test("successful order: validation, server-side totals, confirmation page and persistence", async ({ page, browser }) => {
    const email = uniqueEmail("success");
    const before = DB_URL ? await sql<{ tee: number; lamp: number }>(
      "select (select stock from products where slug='classic-white-tee') tee, (select stock from products where slug='minimal-desk-lamp') lamp",
    ) : null;

    await addToCart(page, "classic-white-tee", 2);
    await addToCart(page, "minimal-desk-lamp");
    await page.goto("/cart");
    await page.getByRole("link", { name: "Checkout" }).click();
    await expect(page).toHaveURL(/\/checkout$/);

    const summary = page.getByRole("region", { name: "Order summary" });
    await expect(summary.getByTestId("summary-line")).toHaveCount(2);
    await expect(summary.getByText("2 × $28.00")).toBeVisible();
    await expect(summary.getByTestId("order-total")).toHaveText("$125.00");

    // Failed validation: nothing is created, entered values are kept.
    await page.getByLabel(/Full name/).fill("Ada Lovelace");
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByText("Please fix the highlighted fields.")).toBeVisible();
    await expect(page.getByText("Email is required")).toBeVisible();
    await expect(page.getByText("Postal code is required")).toBeVisible();
    await expect(page.getByLabel(/Full name/)).toHaveValue("Ada Lovelace");

    await fillCheckout(page, email);
    await page.getByRole("button", { name: "Place order" }).click();

    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);
    await expect(page.getByText("Thank you, your order has been placed!")).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Order #\d+$/ })).toBeVisible();
    await expect(page.getByTestId("order-status")).toHaveText("pending");
    const items = page.getByRole("region", { name: "Items" });
    await expect(items.getByText("Classic White Tee")).toBeVisible();
    await expect(items.getByText("2 × $28.00")).toBeVisible();
    await expect(items.getByTestId("order-total")).toHaveText("$125.00");
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByTestId("cart-count")).toHaveText("0");
    const orderUrl = page.url().replace("?placed=1", "");

    // The order survives a reload (persisted), and the cart is now empty.
    await page.goto(orderUrl);
    await expect(page.getByRole("heading", { name: /^Order #\d+$/ })).toBeVisible();
    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();

    // Another visitor cannot open this order.
    const stranger = await browser.newContext();
    const res = await (await stranger.newPage()).goto(orderUrl);
    expect(res?.status()).toBe(404);
    await stranger.close();

    if (DB_URL) {
      const rows = await ordersFor(email);
      expect(rows).toEqual([expect.objectContaining({ total_cents: 12500, subtotal_cents: 12500, status: "pending", user_id: null, n_items: 2 })]);
      const after = await sql<{ tee: number; lamp: number }>(
        "select (select stock from products where slug='classic-white-tee') tee, (select stock from products where slug='minimal-desk-lamp') lamp",
      );
      expect(after[0].tee).toBe(before![0].tee - 2);
      expect(after[0].lamp).toBe(before![0].lamp - 1);
    }
  });

  test("duplicate submission: double submit and replayed requests create one order", async ({ page }) => {
    test.skip(!DB_URL, "needs E2E_DATABASE_URL to count orders");
    const email = uniqueEmail("dupe");
    await addToCart(page, "canvas-tote-bag");
    await page.goto("/checkout");
    await fillCheckout(page, email);

    // Capture the checkout server-action request so it can be replayed later.
    const actionRequest = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/checkout"));
    // Fire two submits back-to-back before the button can disable itself.
    await page.evaluate(() => {
      const form = document.querySelector<HTMLFormElement>('form[aria-label="Checkout"]')!;
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);
    const orderId = page.url().match(/orders\/([0-9a-f-]{36})/)![1];

    // Replay the exact same submission (e.g. a network retry or a resubmitted form).
    const req = await actionRequest;
    const replay = await page.request.fetch(req.url(), {
      method: "POST",
      headers: await req.allHeaders(),
      data: req.postDataBuffer() ?? undefined,
      maxRedirects: 0,
    });
    expect(replay.status()).toBeLessThan(400);
    expect(JSON.stringify(replay.headers())).toContain(orderId); // redirected to the SAME order

    const rows = await ordersFor(email);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(orderId);
  });

  test("insufficient stock at submit time: clear failure, no order, cart kept", async ({ page }) => {
    test.skip(!DB_URL, "needs E2E_DATABASE_URL to change stock mid-checkout");
    const email = uniqueEmail("stock");
    await addToCart(page, "minimal-desk-lamp", 3);
    await page.goto("/checkout");
    await fillCheckout(page, email);
    const [{ stock }] = await sql<{ stock: number }>("select stock from products where slug = 'minimal-desk-lamp'");
    try {
      await sql("update products set stock = 1 where slug = 'minimal-desk-lamp'"); // someone else bought most of it
      await page.getByRole("button", { name: "Place order" }).click();
      await expect(page.getByText("We couldn't place your order.")).toBeVisible();
      await expect(page.getByText("Not enough stock for Minimal Desk Lamp (1 available). Please update the quantity in your cart.")).toBeVisible();
      await expect(page).toHaveURL(/\/checkout$/);
      expect(await ordersFor(email)).toHaveLength(0);
      const [{ stock: now }] = await sql<{ stock: number }>("select stock from products where slug = 'minimal-desk-lamp'");
      expect(now).toBe(1);

      // The cart is untouched and flags the problem; checkout is blocked until fixed.
      await page.goto("/cart");
      await expect(page.getByText("Only 1 left — please reduce the quantity.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Checkout" })).toHaveCount(0);
      await page.goto("/checkout");
      await expect(page.getByText("Minimal Desk Lamp: only 1 left (you have 3).")).toBeVisible();
      await expect(page.getByRole("button", { name: "Place order" })).toHaveCount(0);
    } finally {
      await sql("update products set stock = $1 where slug = 'minimal-desk-lamp'", [stock]);
    }
  });

  test("invalid product at submit time: deactivated product blocks the order", async ({ page }) => {
    test.skip(!DB_URL, "needs E2E_DATABASE_URL to deactivate a product mid-checkout");
    const email = uniqueEmail("inactive");
    await addToCart(page, "classic-white-tee");
    await addToCart(page, "wool-beanie");
    await page.goto("/checkout");
    await fillCheckout(page, email);
    try {
      await sql("update products set is_active = false where slug = 'wool-beanie'");
      await page.getByRole("button", { name: "Place order" }).click();
      // Availability is part of what the shopper reviewed, so checkout stops and the
      // refreshed page explains which item is no longer sold.
      await expect(page.getByText("Some items in your cart need attention before you can check out.")).toBeVisible();
      await expect(page.getByText("Merino Wool Beanie is no longer available.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Place order" })).toHaveCount(0);
      expect(await ordersFor(email)).toHaveLength(0);
    } finally {
      await sql("update products set is_active = true where slug = 'wool-beanie'");
    }
  });

  test("quantity changed in another tab: checkout refuses, shows the new summary, then succeeds", async ({ page, context }) => {
    const email = uniqueEmail("qty");
    await addToCart(page, "leather-card-wallet"); // $45
    await page.goto("/checkout");
    await expect(page.getByTestId("order-total")).toHaveText("$45.00");
    await fillCheckout(page, email);

    const other = await context.newPage();
    await other.goto("/cart");
    await other.getByRole("button", { name: "Increase quantity of Leather Card Wallet" }).click();
    await expect(other.getByLabel("Quantity of Leather Card Wallet", { exact: true })).toHaveText("2");
    await other.close();

    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByText(/Your cart changed since you opened checkout/)).toBeVisible();
    await expect(page.getByTestId("order-total")).toHaveText("$90.00"); // summary refreshed
    await expect(page.getByLabel(/Full name/)).toHaveValue("Ada Lovelace"); // details kept
    if (DB_URL) expect(await ordersFor(email)).toHaveLength(0);

    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);
    await expect(page.getByRole("region", { name: "Items" }).getByTestId("order-total")).toHaveText("$90.00");
    if (DB_URL) expect((await ordersFor(email))[0].total_cents).toBe(9000);
  });

  test("unknown or malformed order ids return 404", async ({ page }) => {
    for (const id of ["9a0c7d3e-2a59-4c51-9a3e-6c3f7d1d2b10", "not-an-id"]) {
      expect((await page.goto(`/orders/${id}`))?.status()).toBe(404);
    }
  });
});

test("@mobile checkout fits a phone screen", async ({ page }) => {
  await addToCart(page, "classic-white-tee");
  await page.goto("/checkout");
  await expect(page.getByRole("button", { name: "Place order" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
