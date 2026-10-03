import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 1 shopper journey against a live stack (app + Supabase with the
 * migrations and supabase/seed.sql applied). Each test gets a fresh browser
 * context, i.e. a fresh guest cart.
 */

const cartCount = (page: Page) => page.getByTestId("cart-count");
const line = (page: Page, slug: string) => page.getByTestId(`cart-line-${slug}`);

async function addFromProductPage(page: Page, slug: string, quantity = 1) {
  await page.goto(`/products/${slug}`);
  if (quantity > 1) await page.getByLabel("Quantity").selectOption(String(quantity));
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText(/Added to cart \(\d+ in cart\)\./)).toBeVisible();
}

test.describe("catalogue", () => {
  test("homepage shows categories and products from Supabase", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Shop by category" })).toBeVisible();
    for (const name of ["Apparel", "Accessories", "Home"]) {
      await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
    }
    // Featured products exclude out-of-stock items.
    await expect(page.getByRole("link", { name: /Classic White Tee/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Linen Throw Blanket/ })).toHaveCount(0);
  });

  test("product listing, search and category filter", async ({ page }) => {
    await page.goto("/products");
    await expect(page.getByText(/^8 products$/)).toBeVisible();
    const tee = page.getByRole("link", { name: /Classic White Tee/ });
    await expect(tee).toContainText("Apparel");
    await expect(tee).toContainText("$28.00");
    await expect(page.getByRole("link", { name: /Linen Throw Blanket/ })).toContainText("Out of stock");
    await expect(page.getByRole("link", { name: /Ceramic Pour-Over Set/ })).toContainText("Only 3 left");

    await page.getByLabel("Search products", { exact: true }).fill("leather");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/q=leather/);
    await expect(page.getByText("1 product matching “leather”")).toBeVisible();
    await expect(page.getByRole("link", { name: /Leather Card Wallet/ })).toBeVisible();

    await page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: "Home" }).click();
    await expect(page).toHaveURL(/category=home/);
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expect(page.getByText("No products found")).toBeVisible(); // "leather" within Home

    await page.goto("/products?category=home");
    await expect(page.getByText(/^3 products$/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("empty and invalid states", async ({ page }) => {
    await page.goto("/products?q=zzzz-no-match");
    await expect(page.getByRole("heading", { name: "No products found" })).toBeVisible();

    await page.goto("/products?category=does-not-exist");
    await expect(page.getByRole("heading", { name: "Category not found" })).toBeVisible();

    await page.goto("/products?q=%25%27%22%28%29%2C");
    await expect(page.getByRole("heading", { name: "No products found" })).toBeVisible();

    await page.goto("/products?page=999");
    await expect(page.getByRole("heading", { name: "No products found" })).toBeVisible();

    for (const bad of ["does-not-exist", "Not_A_Slug", "3f0c7d3e-2a59-4c51-9a3e-6c3f7d1d2b10", "%27%20or%201%3D1"]) {
      const res = await page.goto(`/products/${bad}`);
      expect(res?.status(), bad).toBe(404);
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    }
  });

  test("product detail page shows details and stock status", async ({ page }) => {
    await page.goto("/products/classic-white-tee");
    await expect(page.getByRole("heading", { name: "Classic White Tee", level: 1 })).toBeVisible();
    await expect(page.getByText("$28.00")).toBeVisible();
    await expect(page.getByText(/Heavyweight 100% organic cotton/)).toBeVisible();
    await expect(page.getByText("In stock")).toBeVisible();
    await expect(page.getByRole("img", { name: "Classic White Tee" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Apparel" })).toBeVisible();

    await page.goto("/products/ceramic-pour-over-set");
    await expect(page.getByText("Only 3 left in stock")).toBeVisible();
    await expect(page.getByLabel("Quantity").locator("option")).toHaveCount(3);

    await page.goto("/products/linen-throw-blanket");
    await expect(page.getByText("Out of stock", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Out of stock" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add to cart" })).toHaveCount(0);
  });
});

test.describe("cart", () => {
  test("empty cart state", async ({ page }) => {
    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
    await expect(cartCount(page)).toHaveText("0");
  });

  test("add to cart, update quantities, remove items, and persistence", async ({ page, context, browser }) => {
    await addFromProductPage(page, "classic-white-tee", 2);
    await expect(cartCount(page)).toHaveText("2");
    await addFromProductPage(page, "minimal-desk-lamp");
    await expect(cartCount(page)).toHaveText("3");
    // Adding the same product again increments it.
    await addFromProductPage(page, "classic-white-tee");
    await expect(page.getByText("Added to cart (3 in cart).")).toBeVisible();
    await expect(cartCount(page)).toHaveText("4");

    // The cart cookie is httpOnly (not readable by page scripts).
    const cookie = (await context.cookies()).find((c) => c.name === "qx_cart");
    expect(cookie?.httpOnly).toBe(true);
    expect(await page.evaluate(() => document.cookie)).not.toContain("qx_cart");

    await page.goto("/cart");
    await expect(line(page, "classic-white-tee")).toContainText("$84.00"); // 3 x 28
    await expect(page.getByTestId("summary-subtotal")).toHaveText("$153.00"); // 84 + 69
    await expect(page.getByTestId("summary-items")).toHaveText("4");

    // Quantity controls.
    await page.getByRole("button", { name: "Increase quantity of Minimal Desk Lamp" }).click();
    await expect(page.getByLabel("Quantity of Minimal Desk Lamp", { exact: true })).toHaveText("2");
    await expect(page.getByTestId("summary-subtotal")).toHaveText("$222.00");
    await expect(cartCount(page)).toHaveText("5");
    await page.getByRole("button", { name: "Decrease quantity of Classic White Tee" }).click();
    await expect(page.getByLabel("Quantity of Classic White Tee", { exact: true })).toHaveText("2");
    await expect(page.getByTestId("summary-subtotal")).toHaveText("$194.00");
    await expect(cartCount(page)).toHaveText("4");

    // Persistence: survives a reload and a brand new tab in the same browser profile.
    await page.reload();
    await expect(page.getByLabel("Quantity of Classic White Tee", { exact: true })).toHaveText("2");
    await expect(page.getByLabel("Quantity of Minimal Desk Lamp", { exact: true })).toHaveText("2");
    const secondTab = await context.newPage();
    await secondTab.goto("/cart");
    await expect(secondTab.getByTestId("summary-subtotal")).toHaveText("$194.00");
    await secondTab.close();

    // Persistence across browser restarts: same cookie in a new context.
    const restored = await browser.newContext({ storageState: await context.storageState() });
    const restoredPage = await restored.newPage();
    await restoredPage.goto("/cart");
    await expect(restoredPage.getByTestId("summary-subtotal")).toHaveText("$194.00");
    await restored.close();

    // A different visitor does not see this cart.
    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await strangerPage.goto("/cart");
    await expect(strangerPage.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
    await stranger.close();

    // Remove items until empty.
    await page.getByRole("button", { name: "Remove Minimal Desk Lamp" }).click();
    await expect(line(page, "minimal-desk-lamp")).toHaveCount(0);
    await expect(page.getByTestId("summary-subtotal")).toHaveText("$56.00");
    await expect(cartCount(page)).toHaveText("2");
    await page.getByRole("button", { name: "Remove Classic White Tee" }).click();
    await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
    await expect(cartCount(page)).toHaveText("0");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
  });

  test("quantity controls respect stock limits", async ({ page }) => {
    await addFromProductPage(page, "ceramic-pour-over-set", 3); // all 3 in stock
    await page.goto("/cart");
    await expect(page.getByLabel("Quantity of Ceramic Pour-Over Set", { exact: true })).toHaveText("3");
    await expect(page.getByRole("button", { name: "Increase quantity of Ceramic Pour-Over Set" })).toBeDisabled();
    await expect(page.getByText("Maximum available")).toBeVisible();
    await expect(page.getByRole("button", { name: "Decrease quantity of Ceramic Pour-Over Set" })).toBeEnabled();

    // Adding more from the product page is capped at stock.
    await addFromProductPage(page, "ceramic-pour-over-set");
    await expect(page.getByText("Added to cart (3 in cart).")).toBeVisible();
  });
});

test("@mobile layout fits a phone screen and keeps key actions reachable", async ({ page }) => {
  for (const path of ["/", "/products", "/products?category=home", "/products/classic-white-tee", "/cart"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
  await page.goto("/products/classic-white-tee");
  await expect(page.getByRole("button", { name: "Add to cart" })).toBeInViewport();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(cartCount(page)).toHaveText("1");
  await page.getByRole("link", { name: /^Cart, 1 item$/ }).click();
  await expect(page.getByRole("button", { name: "Increase quantity of Classic White Tee" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test.describe("legal pages", () => {
  test("privacy policy and terms are linked from the footer and the sign-in page", async ({ page }) => {
    await page.goto("/");
    const legal = page.getByRole("navigation", { name: "Legal" });
    await legal.getByRole("link", { name: "Privacy Policy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
    await expect(page.getByText(/do not access your Gmail/)).toBeVisible();

    await legal.getByRole("link", { name: "Terms of Service" }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();

    await page.goto("/login");
    await expect(page.getByRole("main").getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    await expect(page.getByRole("main").getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });
});
