import { Client } from "pg";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Phase 4: Google sign-in through Supabase Auth, end to end.
 *
 * Runs against Supabase Auth (GoTrue) with its real Google provider enabled.
 * Google itself is replaced by a stand-in: the browser's visit to Google's
 * consent page is intercepted here (simulating the user approving or
 * cancelling), and GoTrue's server-to-server calls to Google's token/userinfo
 * endpoints are served by a local stand-in (see README "End-to-end tests").
 *
 *   E2E_GOOGLE_STANDIN=1   enable these tests
 *   E2E_DATABASE_URL       Postgres connection to the same database
 *   E2E_SUPABASE_URL       Supabase API URL, for direct REST checks
 */
const ENABLED = process.env.E2E_GOOGLE_STANDIN === "1";
const DB_URL = process.env.E2E_DATABASE_URL;
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://localhost:54321";
const ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? "";

const GOOGLE_USERS = {
  alice: { email: "alice.quinnex@example.com", name: "Alice Google" },
  bob: { email: "bob.quinnex@example.com", name: "Bob Google" },
} as const;
type GoogleUser = keyof typeof GOOGLE_USERS;

async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    return (await c.query(query, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/**
 * Simulates Google's consent screen: approve as `user`, or cancel. Supabase
 * Auth's /authorize response (a redirect to Google) is fetched for real; the
 * Google URL it points to is captured and answered as Google would, by
 * redirecting back to Supabase Auth's callback. Returns the captured URLs.
 */
async function simulateGoogle(context: BrowserContext, user: GoogleUser, opts: { cancel?: boolean } = {}) {
  const seen: URL[] = [];
  await context.route("**/auth/v1/authorize?**", async (route) => {
    const upstream = await route.fetch({ maxRedirects: 0 });
    const location = upstream.headers()["location"];
    if (!location?.startsWith("https://accounts.google.com/")) return route.fulfill({ response: upstream });
    const url = new URL(location);
    seen.push(url);
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    if (opts.cancel) {
      back.searchParams.set("error", "access_denied");
    } else {
      const code = Buffer.from(JSON.stringify({ user, nonce: url.searchParams.get("nonce") ?? undefined })).toString("base64url");
      back.searchParams.set("code", code);
    }
    // Keep any cookies Supabase Auth set on the /authorize response.
    await route.fulfill({ status: 302, headers: { ...upstream.headers(), location: back.toString() } });
  });
  return seen;
}

async function signIn(page: Page, user: GoogleUser, next = "/account") {
  const seen = await simulateGoogle(page.context(), user);
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForURL((u) => u.pathname === next);
  return seen;
}

async function placeOrder(page: Page, email: string, slug = "wool-beanie") {
  await page.goto(`/products/${slug}`);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText(/Added to cart/)).toBeVisible();
  await page.goto("/checkout");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Full name/).fill("Test Customer");
  await page.getByLabel(/^Address/).fill("1 Marina Road");
  await page.getByLabel(/City/).fill("Lagos");
  await page.getByLabel(/Postal code/).fill("100001");
  await page.getByLabel("Country").selectOption("NG");
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);
  const id = page.url().match(/orders\/([0-9a-f-]{36})/)![1];
  const number = (await page.getByRole("heading", { name: /^Order #\d+$/ }).textContent())!.replace("Order #", "");
  return { id, number, url: `/orders/${id}` };
}

/** The Supabase access token from the @supabase/ssr session cookie(s). */
async function accessToken(context: BrowserContext) {
  const parts = (await context.cookies())
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((c) => c.value)
    .join("");
  const raw = parts.startsWith("base64-") ? Buffer.from(parts.slice(7), "base64url").toString() : decodeURIComponent(parts);
  return (JSON.parse(raw) as { access_token: string }).access_token;
}

test.describe("Google sign-in (Supabase Auth)", () => {
  test.skip(!ENABLED || !DB_URL, "needs Supabase Auth with the Google provider + Google stand-in (E2E_GOOGLE_STANDIN=1)");
  test.describe.configure({ mode: "serial" });

  test("protected route: signed-out visitors are sent to sign in", async ({ page }) => {
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByTestId("auth-nav")).toHaveText("Sign in");
  });

  test("Google login: consent → Supabase Auth → app callback → session → back to the shop", async ({ page }) => {
    const callbacks: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/auth/callback") callbacks.push(r.url());
    });
    const seen = await signIn(page, "alice", "/account");

    // The consent request was made by Supabase Auth with the configured Google client.
    expect(seen).toHaveLength(1);
    const auth = seen[0];
    expect(auth.searchParams.get("client_id")).toBe("quinnex-test-client.apps.googleusercontent.com");
    expect(auth.searchParams.get("redirect_uri")).toMatch(/\/auth\/v1\/callback$/);
    expect(auth.searchParams.get("response_type")).toBe("code");
    expect(auth.searchParams.get("scope")).toContain("email");
    expect(auth.searchParams.get("prompt")).toBe("select_account");

    // Supabase Auth returned to our callback with a PKCE code, which became a session.
    expect(callbacks).toHaveLength(1);
    expect(new URL(callbacks[0]).searchParams.get("code")).toBeTruthy();
    await expect(page.getByTestId("account-name")).toHaveText("Alice Google");
    await expect(page.getByTestId("account-email")).toHaveText(GOOGLE_USERS.alice.email);
    await expect(page.getByTestId("auth-nav")).toContainText("Account");

    // The Supabase Auth user (Google identity) and its profile exist, keyed by the same id.
    const [u] = await sql<{ id: string; provider: string; profile_id: string; full_name: string }>(
      `select u.id, i.provider, p.id as profile_id, p.full_name
       from auth.users u join auth.identities i on i.user_id = u.id left join public.profiles p on p.id = u.id
       where u.email = $1`,
      [GOOGLE_USERS.alice.email],
    );
    expect(u).toMatchObject({ provider: "google", full_name: "Alice Google" });
    expect(u.profile_id).toBe(u.id);
  });

  test("session persistence: reloads, navigation, new tabs and a restarted browser stay signed in", async ({ page, browser }) => {
    await signIn(page, "alice");
    await page.reload();
    await expect(page.getByTestId("account-name")).toHaveText("Alice Google");
    await page.goto("/products");
    await expect(page.getByTestId("auth-nav")).toContainText("Account");
    const tab = await page.context().newPage();
    await tab.goto("/account");
    await expect(tab.getByTestId("account-name")).toHaveText("Alice Google");

    const restored = await browser.newContext({ storageState: await page.context().storageState() });
    const p2 = await restored.newPage();
    await p2.goto("/account");
    await expect(p2.getByTestId("account-name")).toHaveText("Alice Google");
    await restored.close();
  });

  test("own orders: listed on the account page and viewable from any device", async ({ page, browser }) => {
    await signIn(page, "alice", "/");
    const order = await placeOrder(page, GOOGLE_USERS.alice.email);
    const [row] = await sql<{ user_id: string; email: string }>(
      "select o.user_id, u.email from orders o join auth.users u on u.id = o.user_id where o.id = $1",
      [order.id],
    );
    expect(row.email).toBe(GOOGLE_USERS.alice.email); // associated with the Supabase Auth user id

    await page.goto("/account");
    await expect(page.getByRole("list", { name: "My orders" }).getByText(`Order #${order.number}`)).toBeVisible();

    // A second device: same Google account, no cart cookie from the first browser.
    const device2 = await browser.newContext();
    const p2 = await device2.newPage();
    await signIn(p2, "alice");
    await expect(p2.getByRole("list", { name: "My orders" }).getByText(`Order #${order.number}`)).toBeVisible();
    await p2.goto(order.url);
    await expect(p2.getByRole("heading", { name: `Order #${order.number}` })).toBeVisible();
    await device2.close();
  });

  test("another user's orders cannot be accessed (pages and direct API calls)", async ({ page, browser }) => {
    await signIn(page, "alice", "/");
    const aliceOrder = await placeOrder(page, GOOGLE_USERS.alice.email, "canvas-tote-bag");

    const bobCtx = await browser.newContext();
    const bob = await bobCtx.newPage();
    await signIn(bob, "bob", "/");
    const bobOrder = await placeOrder(bob, GOOGLE_USERS.bob.email, "leather-card-wallet");

    await bob.goto("/account");
    const bobList = bob.getByRole("list", { name: "My orders" });
    await expect(bobList.getByText(`Order #${bobOrder.number}`)).toBeVisible();
    await expect(bobList.getByText(`Order #${aliceOrder.number}`)).toHaveCount(0);
    expect((await bob.goto(aliceOrder.url))?.status()).toBe(404);

    // Directly against the Supabase REST API with Bob's own access token (what a tampered browser could do).
    const token = await accessToken(bobCtx);
    const headers = { apikey: ANON_KEY, Authorization: `Bearer ${token}` };
    const all = await (await bob.request.get(`${SUPABASE_URL}/rest/v1/orders?select=id,user_id`, { headers })).json();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((o: { id: string }) => o.id !== aliceOrder.id)).toBe(true);
    const byId = await (await bob.request.get(`${SUPABASE_URL}/rest/v1/orders?select=id&id=eq.${aliceOrder.id}`, { headers })).json();
    expect(byId).toEqual([]);
    const items = await (await bob.request.get(`${SUPABASE_URL}/rest/v1/order_items?select=id&order_id=eq.${aliceOrder.id}`, { headers })).json();
    expect(items).toEqual([]);
    const rpc = await (await bob.request.post(`${SUPABASE_URL}/rest/v1/rpc/get_order`, { headers, data: { p_token: null, p_order_id: aliceOrder.id } })).json();
    expect(rpc).toBeNull();
    const secret = await bob.request.get(`${SUPABASE_URL}/rest/v1/orders?select=cart_token_hash`, { headers });
    expect(secret.status()).toBe(403); // internal column not readable at all
    expect((await secret.json()).code).toBe("42501"); // permission denied
    await bobCtx.close();
  });

  test("guest orders from this browser with the same email are linked at sign-in", async ({ page }) => {
    const mine = await placeOrder(page, GOOGLE_USERS.alice.email, "classic-white-tee");
    const someoneElse = await placeOrder(page, "flatmate@example.com", "classic-white-tee");
    await signIn(page, "alice");
    const list = page.getByRole("list", { name: "My orders" });
    await expect(list.getByText(`Order #${mine.number}`)).toBeVisible();
    await expect(list.getByText(`Order #${someoneElse.number}`)).toHaveCount(0);
  });

  test("logout ends the session everywhere it was copied", async ({ page, browser }) => {
    await signIn(page, "alice");
    const copied = await page.context().storageState(); // e.g. a second tab or a stolen cookie jar
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("auth-nav")).toHaveText("Sign in");
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);

    const stale = await browser.newContext({ storageState: copied });
    const p2 = await stale.newPage();
    await p2.goto("/account");
    await expect(p2).toHaveURL(/\/login/);
    await stale.close();
  });

  test("error state: cancelling Google consent shows a clear message and no session", async ({ page }) => {
    await simulateGoogle(page.context(), "alice", { cancel: true });
    await page.goto("/login?next=%2Faccount");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.waitForURL(/\/login\?/);
    await expect(page).toHaveURL(/\/login\?error=access_denied&next=%2Faccount(#.*)?$/); // Supabase also appends #error=…
    await expect(page.getByText("Google sign-in was cancelled. You can try again whenever you're ready.")).toBeVisible();
    await expect(page.getByTestId("auth-nav")).toHaveText("Sign in");
  });

  test("error state: an invalid or replayed callback code is rejected", async ({ page }) => {
    await page.goto("/auth/callback?code=forged-code&next=%2Faccount");
    await expect(page).toHaveURL(/\/login\?error=callback&next=%2Faccount$/);
    await expect(page.getByText("We couldn't complete your sign-in. Please try again.")).toBeVisible();
    await page.goto("/auth/callback?next=%2F%2Fevil.example");
    await expect(page).toHaveURL(/\/login\?error=missing_code&next=%2F$/);
  });
});
