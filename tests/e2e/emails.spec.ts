import { existsSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 3: order confirmation emails, end to end.
 *
 * Requires a Mailgun stand-in (or a Mailgun sandbox) and direct DB access:
 *   E2E_MAIL_LOG         JSON-lines log of messages the stand-in accepted
 *   E2E_MAILGUN_CONTROL  stand-in control URL (…/__mode) to simulate outages
 *   E2E_DATABASE_URL     Postgres connection to the same database
 *
 * The "misconfigured" block runs only when the app server was started with a
 * broken Mailgun configuration and E2E_EXPECT_EMAIL_ERROR is set.
 */
const MAIL_LOG = process.env.E2E_MAIL_LOG;
const CONTROL = process.env.E2E_MAILGUN_CONTROL;
const DB_URL = process.env.E2E_DATABASE_URL;
const MISCONFIGURED = process.env.E2E_EXPECT_EMAIL_ERROR;

type Mail = { to: string; subject: string; text: string; html: string; from: string; "h:Reply-To"?: string; "o:tag"?: string };

const mailsTo = (email: string): Mail[] =>
  MAIL_LOG && existsSync(MAIL_LOG)
    ? readFileSync(MAIL_LOG, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Mail)
        .filter((m) => m.to === email)
    : [];

async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    return (await c.query(query, params)).rows as T[];
  } finally {
    await c.end();
  }
}

const emailState = (email: string) =>
  sql<{ order_number: number; status: string; email_status: string; attempts: number; last_error: string | null; message_id: string | null; log: string[] }>(
    `select o.order_number, o.status, o.confirmation_email_status email_status, o.confirmation_email_attempts attempts,
            o.confirmation_email_last_error last_error, o.confirmation_email_message_id message_id,
            coalesce((select array_agg(a.outcome order by a.attempted_at) from order_email_attempts a where a.order_id = o.id), '{}') log
     from orders o where o.email = $1`,
    [email],
  );

const setMailgun = (status: number) => fetch(`${CONTROL}?status=${status}`);
const uniqueEmail = (tag: string) => `e2e-mail-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.com`;

async function checkout(page: Page, email: string, products: [string, number][] = [["classic-white-tee", 2], ["minimal-desk-lamp", 1]]) {
  for (const [slug, qty] of products) {
    await page.goto(`/products/${slug}`);
    if (qty > 1) await page.getByLabel("Quantity").selectOption(String(qty));
    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page.getByText(/Added to cart/)).toBeVisible();
  }
  await page.goto("/checkout");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Full name/).fill("Ada Lovelace");
  await page.getByLabel(/^Address/).fill("1 Marina Road");
  await page.getByLabel(/City/).fill("Lagos");
  await page.getByLabel(/Postal code/).fill("100001");
  await page.getByLabel("Country").selectOption("NG");
}

test.describe("order confirmation emails", () => {
  test.skip(!MAIL_LOG || !CONTROL || !DB_URL || !!MISCONFIGURED, "needs the Mailgun stand-in, E2E_DATABASE_URL and a valid config");
  test.beforeEach(async () => {
    await setMailgun(200);
  });

  test("successful order + successful email", async ({ page }) => {
    const email = uniqueEmail("ok");
    await checkout(page, email);
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);
    await expect(page.getByText("Thank you, your order has been placed!")).toBeVisible();
    await expect(page.getByTestId("email-status")).toHaveText(`A confirmation email was sent to ${email}.`);

    const [mail, ...rest] = mailsTo(email);
    expect(rest).toHaveLength(0);
    const [row] = await emailState(email);
    expect(mail.from).toBe("Quinnex Store <orders@mg.quinnex-test.com>");
    expect(mail["h:Reply-To"]).toBe("help@quinnex-test.com");
    expect(mail["o:tag"]).toBe("order-confirmation");
    expect(mail.subject).toBe(`Your Quinnex Store order #${row.order_number}`);
    for (const s of [
      "Quinnex Store",
      "Hi Ada Lovelace,",
      `Order number: #${row.order_number}`,
      "Order date: ",
      "- Classic White Tee: 2 x $28.00 = $56.00",
      "- Minimal Desk Lamp: 1 x $69.00 = $69.00",
      "Subtotal: $125.00",
      "Total: $125.00",
      "Contact us at help@quinnex-test.com",
    ]) {
      expect(mail.text).toContain(s);
    }
    expect(mail.html).toContain("$125.00");

    expect(row).toMatchObject({ status: "pending", email_status: "sent", attempts: 1, last_error: null, log: ["sent"] });
    expect(row.message_id).toMatch(/@mg\.quinnex-test\.com>$/);
  });

  test("successful order + Mailgun failure: order kept, customer sees success, failure logged, retry works", async ({ page }) => {
    const email = uniqueEmail("outage");
    await checkout(page, email, [["canvas-tote-bag", 1]]);
    await setMailgun(500);
    await page.getByRole("button", { name: "Place order" }).click();

    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);
    await expect(page.getByText("Thank you, your order has been placed!")).toBeVisible();
    await expect(page.getByTestId("email-status")).toContainText(`We couldn't send your confirmation email to ${email}`);
    await expect(page.getByTestId("cart-count")).toHaveText("0");
    expect(mailsTo(email)).toHaveLength(0);

    let [row] = await emailState(email);
    expect(row).toMatchObject({ status: "pending", email_status: "failed", attempts: 1, log: ["failed"] });
    expect(row.last_error).toContain("Mailgun responded 500");

    // Mailgun recovers; the customer retries from the confirmation page.
    await setMailgun(200);
    await page.getByRole("button", { name: "Resend confirmation email" }).click();
    await expect(page.getByTestId("email-status")).toHaveText(`A confirmation email was sent to ${email}.`);
    expect(mailsTo(email)).toHaveLength(1);
    [row] = await emailState(email);
    expect(row).toMatchObject({ email_status: "sent", attempts: 2, last_error: null, log: ["failed", "sent"] });
  });

  test("duplicate checkout submission sends exactly one email", async ({ page }) => {
    const email = uniqueEmail("dupe");
    await checkout(page, email, [["wool-beanie", 1]]);
    const actionRequest = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/checkout"));
    await page.evaluate(() => {
      const form = document.querySelector<HTMLFormElement>('form[aria-label="Checkout"]')!;
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);
    const req = await actionRequest;
    for (let i = 0; i < 2; i++) {
      const replay = await page.request.fetch(req.url(), { method: "POST", headers: await req.allHeaders(), data: req.postDataBuffer() ?? undefined, maxRedirects: 0 });
      expect(replay.status()).toBeLessThan(400);
    }
    expect(mailsTo(email)).toHaveLength(1);
    const rows = await emailState(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email_status: "sent", attempts: 1, log: ["sent"] });
  });

  test("missing customer email: checkout is refused before any order or email", async ({ page }) => {
    await checkout(page, "placeholder@example.com", [["wool-beanie", 1]]);
    await page.getByLabel("Email").fill("");
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByText("Email is required")).toBeVisible();
    await expect(page).toHaveURL(/\/checkout$/);
    expect(mailsTo("")).toHaveLength(0);
  });
});

test.describe("misconfigured Mailgun", () => {
  test.skip(!MISCONFIGURED || !DB_URL, "run with the app started using a broken Mailgun config");

  test("order still succeeds and the configuration error is recorded", async ({ page }) => {
    const email = uniqueEmail("misconfig");
    await checkout(page, email, [["leather-card-wallet", 1]]);
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);
    await expect(page.getByText("Thank you, your order has been placed!")).toBeVisible();
    await expect(page.getByTestId("email-status")).toContainText("We couldn't send your confirmation email");
    const [row] = await emailState(email);
    expect(row).toMatchObject({ status: "pending", email_status: "failed", attempts: 1, log: ["failed"] });
    expect(row.last_error).toMatch(new RegExp(MISCONFIGURED!));
    expect(mailsTo(email)).toHaveLength(0);
  });
});
