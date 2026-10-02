/**
 * Integration tests for place_order / get_order against a real PostgreSQL
 * server, executed as the `anon` role (what the app's public key can do).
 *
 *   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db
 *
 * Skipped when TEST_DATABASE_URL is not set.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const root = path.resolve(__dirname, "../..");
const newToken = () => randomBytes(32).toString("base64url");

const customer = {
  email: "  Ada@Example.COM ",
  name: "Ada Lovelace",
  phone: "+234 800 000 0000",
  line1: "1 Marina Road",
  line2: "",
  city: "Lagos",
  state: "Lagos",
  postal_code: "100001",
  country: "ng",
};

type OrderJson = {
  id: string;
  order_number: number;
  status: string;
  currency: string;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  email: string;
  customer_name: string;
  shipping_country: string;
  items: { product_slug: string; product_name: string; unit_price_cents: number; quantity: number; line_total_cents: number }[];
};

describe.skipIf(!ADMIN_URL)("checkout (database)", () => {
  const dbName = `store_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: Client;
  let db: Client;
  let dbUrl: string;

  async function asAnon<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await db.query("begin");
    try {
      await db.query("set local role anon");
      const res = await db.query(sql, params);
      await db.query("commit");
      return res.rows as T[];
    } catch (err) {
      await db.query("rollback");
      throw err;
    }
  }

  const productId = async (slug: string) =>
    (await db.query("select id from public.products where slug = $1", [slug])).rows[0].id as string;
  const stock = async (slug: string) =>
    (await db.query("select stock from public.products where slug = $1", [slug])).rows[0].stock as number;
  const orderCount = async () => (await db.query("select count(*)::int n from public.orders")).rows[0].n as number;
  const itemCount = async () => (await db.query("select count(*)::int n from public.order_items")).rows[0].n as number;
  const cartQty = async (token: string) =>
    (await asAnon<{ quantity: number }>("select quantity from public.get_cart($1)", [token])).map((r) => r.quantity);

  const add = (token: string, slug: string, qty = 1) =>
    productId(slug).then((id) => asAnon("select public.add_to_cart($1, $2, $3)", [token, id, qty]));
  const fingerprint = async (token: string) =>
    (await asAnon<{ f: string }>("select public.get_cart_fingerprint($1) as f", [token]))[0].f;
  const place = async (token: string, key: string, fp: string | null, cust: object = customer) =>
    (await asAnon<{ id: string }>("select public.place_order($1, $2, $3, $4) as id", [token, key, fp, cust]))[0].id;
  const getOrder = async (token: string | null, id: string) =>
    (await asAnon<{ o: OrderJson | null }>("select public.get_order($1, $2) as o", [token, id]))[0].o;

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    dbUrl = url.toString();
    db = new Client({ connectionString: dbUrl });
    await db.connect();
    await db.query(readFileSync(path.join(root, "tests/db/supabase-stub.sql"), "utf8"));
    const dir = path.join(root, "supabase/migrations");
    for (const file of readdirSync(dir).sort()) await db.query(readFileSync(path.join(dir, file), "utf8"));
  });

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await db.query("delete from public.order_items; delete from public.orders; delete from public.cart_items; delete from public.carts;");
    await db.query(readFileSync(path.join(root, "supabase/seed.sql"), "utf8"));
  });

  it("creates an order with server-side prices, snapshots items, decrements stock and empties the cart", async () => {
    const token = newToken();
    await add(token, "classic-white-tee", 2); // 2 x 2800
    await add(token, "minimal-desk-lamp", 1); // 1 x 6900
    const id = await place(token, randomUUID(), await fingerprint(token));

    const order = (await getOrder(token, id))!;
    expect(order).toMatchObject({
      status: "pending",
      currency: "USD",
      subtotal_cents: 12500,
      shipping_cents: 0,
      total_cents: 12500,
      email: "ada@example.com",
      customer_name: "Ada Lovelace",
      shipping_country: "NG",
    });
    expect(order.order_number).toBeGreaterThanOrEqual(1001);
    expect(order.items).toEqual([
      expect.objectContaining({ product_slug: "classic-white-tee", product_name: "Classic White Tee", unit_price_cents: 2800, quantity: 2, line_total_cents: 5600 }),
      expect.objectContaining({ product_slug: "minimal-desk-lamp", product_name: "Minimal Desk Lamp", unit_price_cents: 6900, quantity: 1, line_total_cents: 6900 }),
    ]);

    expect(await stock("classic-white-tee")).toBe(48);
    expect(await stock("minimal-desk-lamp")).toBe(24);
    expect(await cartQty(token)).toEqual([]);

    // Persistence: rows really exist, with a hashed cart reference and no user (guest).
    const row = (await db.query("select * from public.orders where id = $1", [id])).rows[0];
    expect(row.user_id).toBeNull();
    expect(Buffer.from(row.cart_token_hash)).toHaveLength(32);
    expect(await itemCount()).toBe(2);
  });

  it("snapshots names and prices so later product edits do not change the order", async () => {
    const token = newToken();
    await add(token, "classic-white-tee", 1);
    const id = await place(token, randomUUID(), await fingerprint(token));
    await db.query("update public.products set name = 'Renamed', price_cents = 9999 where slug = 'classic-white-tee'");
    const order = (await getOrder(token, id))!;
    expect(order.items[0]).toMatchObject({ product_name: "Classic White Tee", unit_price_cents: 2800 });
    expect(order.total_cents).toBe(2800);
  });

  it("records the signed-in user id when the request is authenticated", async () => {
    const userId = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, 'ada@example.com')", [userId]);
    const token = newToken();
    await add(token, "wool-beanie", 1);
    const fp = await fingerprint(token);
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await db.query("set local role authenticated");
    const { rows } = await db.query("select public.place_order($1, $2, $3, $4) as id", [token, randomUUID(), fp, customer]);
    await db.query("commit");
    const row = (await db.query("select user_id from public.orders where id = $1", [rows[0].id])).rows[0];
    expect(row.user_id).toBe(userId);
  });

  it("rejects checkout of an empty cart (and of an unknown cart) without creating anything", async () => {
    const token = newToken();
    await expect(place(token, randomUUID(), await fingerprint(token))).rejects.toThrow(/CART_EMPTY/);
    await add(token, "wool-beanie", 1);
    const tee = await productId("wool-beanie");
    await asAnon("select public.remove_cart_item($1, $2)", [token, tee]);
    await expect(place(token, randomUUID(), await fingerprint(token))).rejects.toThrow(/CART_EMPTY/);
    expect(await orderCount()).toBe(0);
  });

  it("rejects products that are no longer active and rolls everything back", async () => {
    const token = newToken();
    await add(token, "classic-white-tee", 1);
    await add(token, "wool-beanie", 1);
    await db.query("update public.products set is_active = false where slug = 'wool-beanie'");
    // Fingerprint taken AFTER deactivation, so this isolates the availability check.
    await expect(place(token, randomUUID(), await fingerprint(token))).rejects.toThrow(/PRODUCT_UNAVAILABLE: Merino Wool Beanie/);
    expect(await orderCount()).toBe(0);
    expect(await itemCount()).toBe(0);
    expect(await stock("classic-white-tee")).toBe(50);
    expect(await cartQty(token)).toHaveLength(2);
  });

  it("rejects insufficient stock and rolls everything back", async () => {
    const token = newToken();
    await add(token, "classic-white-tee", 1);
    await add(token, "minimal-desk-lamp", 5);
    await db.query("update public.products set stock = 2 where slug = 'minimal-desk-lamp'");
    await expect(place(token, randomUUID(), await fingerprint(token))).rejects.toThrow(/INSUFFICIENT_STOCK: Minimal Desk Lamp \(2 available\)/);
    expect(await orderCount()).toBe(0);
    expect(await stock("classic-white-tee")).toBe(50);
    expect(await stock("minimal-desk-lamp")).toBe(2);
    expect(await cartQty(token)).toEqual([1, 5]);
  });

  it("refuses when the cart changed after the checkout page was shown (quantity or price)", async () => {
    const token = newToken();
    await add(token, "classic-white-tee", 1);
    const shown = await fingerprint(token);

    await add(token, "classic-white-tee", 2); // quantity changed in another tab
    await expect(place(token, randomUUID(), shown)).rejects.toThrow(/CART_CHANGED/);

    const reviewed = await fingerprint(token);
    await db.query("update public.products set price_cents = 3000 where slug = 'classic-white-tee'"); // price changed
    await expect(place(token, randomUUID(), reviewed)).rejects.toThrow(/CART_CHANGED/);
    await expect(place(token, randomUUID(), null)).rejects.toThrow(/CART_CHANGED/);
    expect(await orderCount()).toBe(0);

    // Re-reviewing the updated cart succeeds with the new quantity and price.
    const id = await place(token, randomUUID(), await fingerprint(token));
    expect((await getOrder(token, id))!).toMatchObject({ total_cents: 3 * 3000 });
  });

  it("is idempotent: submitting the same checkout twice creates exactly one order", async () => {
    const token = newToken();
    await add(token, "classic-white-tee", 2);
    const key = randomUUID();
    const fp = await fingerprint(token);
    const first = await place(token, key, fp);
    const second = await place(token, key, fp); // cart is empty now, but the key matches
    expect(second).toBe(first);
    expect(await orderCount()).toBe(1);
    expect(await itemCount()).toBe(1);
    expect(await stock("classic-white-tee")).toBe(48);
  });

  it("handles concurrent duplicate submissions without creating two orders", async () => {
    const token = newToken();
    await add(token, "classic-white-tee", 1);
    const key = randomUUID();
    const fp = await fingerprint(token);
    const submit = async () => {
      const c = new Client({ connectionString: dbUrl });
      await c.connect();
      try {
        await c.query("set role anon");
        return (await c.query("select public.place_order($1, $2, $3, $4) as id", [token, key, fp, customer])).rows[0].id;
      } finally {
        await c.end();
      }
    };
    const ids = await Promise.all([submit(), submit(), submit()]);
    expect(new Set(ids).size).toBe(1);
    expect(await orderCount()).toBe(1);
    expect(await stock("classic-white-tee")).toBe(49);
  });

  it("rejects reusing another cart's idempotency key", async () => {
    const alice = newToken();
    const mallory = newToken();
    await add(alice, "wool-beanie", 1);
    await add(mallory, "wool-beanie", 1);
    const key = randomUUID();
    await place(alice, key, await fingerprint(alice));
    await expect(place(mallory, key, await fingerprint(mallory))).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
  });

  it("prevents two shoppers from buying the last unit", async () => {
    await db.query("update public.products set stock = 1 where slug = 'ceramic-pour-over-set'");
    const a = newToken();
    const b = newToken();
    await add(a, "ceramic-pour-over-set", 1);
    await add(b, "ceramic-pour-over-set", 1);
    const fa = await fingerprint(a);
    const fb = await fingerprint(b);
    const submit = async (token: string, fp: string) => {
      const c = new Client({ connectionString: dbUrl });
      await c.connect();
      try {
        await c.query("set role anon");
        await c.query("select public.place_order($1, $2, $3, $4)", [token, randomUUID(), fp, customer]);
        return "ok";
      } catch (err) {
        return (err as Error).message;
      } finally {
        await c.end();
      }
    };
    const results = await Promise.all([submit(a, fa), submit(b, fb)]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.find((r) => r !== "ok")).toMatch(/INSUFFICIENT_STOCK/);
    expect(await stock("ceramic-pour-over-set")).toBe(0);
    expect(await orderCount()).toBe(1);
  });

  it("validates customer details server-side", async () => {
    const token = newToken();
    await add(token, "wool-beanie", 1);
    const fp = await fingerprint(token);
    await expect(place(token, randomUUID(), fp, { ...customer, email: "nope" })).rejects.toThrow(/INVALID_INPUT: email/);
    await expect(place(token, randomUUID(), fp, { ...customer, name: "  " })).rejects.toThrow(/INVALID_INPUT: name/);
    await expect(place(token, randomUUID(), fp, { ...customer, line1: "" })).rejects.toThrow(/INVALID_INPUT: shipping/);
    await expect(place(token, randomUUID(), fp, { ...customer, country: "Nigeria" })).rejects.toThrow(/INVALID_INPUT: shipping/);
    await expect(place("bad", randomUUID(), fp)).rejects.toThrow(/INVALID_CART_TOKEN/);
    expect(await orderCount()).toBe(0);
  });

  it("only shows an order to the cart that placed it", async () => {
    const owner = newToken();
    await add(owner, "wool-beanie", 1);
    const id = await place(owner, randomUUID(), await fingerprint(owner));
    expect(await getOrder(owner, id)).not.toBeNull();
    expect(await getOrder(newToken(), id)).toBeNull();
    expect(await getOrder(null, id)).toBeNull();
    expect(await getOrder(owner, randomUUID())).toBeNull();
  });

  it("gives visitors no direct access to orders", async () => {
    await expect(asAnon("select * from public.orders")).rejects.toThrow(/permission denied/);
    await expect(asAnon("select * from public.order_items")).rejects.toThrow(/permission denied/);
    await expect(
      asAnon(
        "insert into public.orders (cart_token_hash, idempotency_key, currency, subtotal_cents, total_cents, email, customer_name, shipping_line1, shipping_city, shipping_postal_code, shipping_country) values ('\\x00', $1, 'USD', 0, 0, 'a@b.co', 'x', 'x', 'x', 'x', 'NG')",
        [randomUUID()],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asAnon("select public._cart_fingerprint($1)", [randomUUID()])).rejects.toThrow(/permission denied/);
  });

  it("enforces total and line-total integrity at the table level", async () => {
    await expect(
      db.query(
        "insert into public.orders (cart_token_hash, idempotency_key, currency, subtotal_cents, total_cents, email, customer_name, shipping_line1, shipping_city, shipping_postal_code, shipping_country) values ('\\x00', $1, 'USD', 100, 1, 'a@b.co', 'x', 'x', 'x', 'x', 'NG')",
        [randomUUID()],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
