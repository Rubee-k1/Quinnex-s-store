/**
 * Integration tests for supabase/migrations against a real PostgreSQL server.
 * Each run creates a throwaway database, applies a minimal Supabase role stub
 * + the migrations + the seed, and runs queries as the `anon` role with RLS
 * enforced — exactly what the app's anon key can do through PostgREST.
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

describe.skipIf(!ADMIN_URL)("catalogue and guest cart (database)", () => {
  const dbName = `store_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: Client;
  let db: Client;

  /** Run a query as the anonymous API role (what the browser's anon key gets). */
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

  const cart = (token: string) =>
    asAnon<{ slug: string; quantity: number; is_active: boolean; stock: number; price_cents: number }>(
      "select * from public.get_cart($1)",
      [token],
    );

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    db = new Client({ connectionString: url.toString() });
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
    await db.query("delete from public.cart_items; delete from public.carts;");
    await db.query(readFileSync(path.join(root, "supabase/seed.sql"), "utf8"));
  });

  describe("catalogue", () => {
    it("exposes categories and active products with their category", async () => {
      const cats = await asAnon<{ slug: string }>("select slug from public.categories order by sort_order");
      expect(cats.map((c) => c.slug)).toEqual(["apparel", "accessories", "home"]);

      const rows = await asAnon<{ slug: string; category: string }>(
        "select p.slug, c.slug as category from public.products p join public.categories c on c.id = p.category_id order by p.slug",
      );
      expect(rows).toHaveLength(8);
      expect(rows.find((r) => r.slug === "minimal-desk-lamp")?.category).toBe("home");
    });

    it("hides inactive products from visitors", async () => {
      await db.query("update public.products set is_active = false where slug = 'wool-beanie'");
      const rows = await asAnon<{ slug: string }>("select slug from public.products");
      expect(rows.map((r) => r.slug)).not.toContain("wool-beanie");
      expect(rows).toHaveLength(7);
    });

    it("does not let visitors modify catalogue data", async () => {
      await expect(asAnon("update public.products set price_cents = 1")).rejects.toThrow(/permission denied/);
      await expect(asAnon("insert into public.categories (slug, name) values ('x', 'X')")).rejects.toThrow(/permission denied/);
    });

    it("enforces data integrity constraints", async () => {
      const cat = (await db.query("select id from public.categories limit 1")).rows[0].id;
      await expect(
        db.query("insert into public.products (slug, name, category_id, price_cents) values ('bad', 'Bad', $1, -1)", [cat]),
      ).rejects.toThrow(/check constraint/);
      await expect(
        db.query("insert into public.products (slug, name, category_id, price_cents) values ('Bad Slug', 'Bad', $1, 1)", [cat]),
      ).rejects.toThrow(/check constraint/);
      await expect(
        db.query("insert into public.products (slug, name, category_id, price_cents) values ('orphan', 'Orphan', $1, 1)", [randomUUID()]),
      ).rejects.toThrow(/foreign key/);
    });
  });

  describe("guest cart", () => {
    it("gives visitors no direct access to cart tables", async () => {
      await expect(asAnon("select * from public.carts")).rejects.toThrow(/permission denied/);
      await expect(asAnon("select * from public.cart_items")).rejects.toThrow(/permission denied/);
      await expect(asAnon("select public._cart_id_for_token($1, true)", [newToken()])).rejects.toThrow(/permission denied/);
    });

    it("returns an empty cart for a token that has no cart yet", async () => {
      expect(await cart(newToken())).toEqual([]);
    });

    it("rejects malformed tokens", async () => {
      await expect(cart("short")).rejects.toThrow(/INVALID_CART_TOKEN/);
      await expect(asAnon("select public.add_to_cart($1, $2, 1)", ["' or 1=1 --", await productId("wool-beanie")])).rejects.toThrow(
        /INVALID_CART_TOKEN/,
      );
    });

    it("adds items, increments atomically and persists them under the token", async () => {
      const token = newToken();
      const tee = await productId("classic-white-tee");
      await asAnon("select public.add_to_cart($1, $2, 2)", [token, tee]);
      const [{ q }] = await asAnon<{ q: number }>("select public.add_to_cart($1, $2, 3) as q", [token, tee]);
      expect(q).toBe(5);

      const rows = await cart(token);
      expect(rows).toEqual([expect.objectContaining({ slug: "classic-white-tee", quantity: 5, price_cents: 2800 })]);

      // Only the hash of the token is stored.
      const stored = (await db.query("select token_hash from public.carts")).rows;
      expect(stored).toHaveLength(1);
      expect(Buffer.from(stored[0].token_hash).toString("utf8")).not.toContain(token);
    });

    it("caps quantity at available stock", async () => {
      const token = newToken();
      const pour = await productId("ceramic-pour-over-set"); // stock 3
      const [{ q }] = await asAnon<{ q: number }>("select public.add_to_cart($1, $2, 10) as q", [token, pour]);
      expect(q).toBe(3);
      const [{ q: again }] = await asAnon<{ q: number }>("select public.add_to_cart($1, $2, 1) as q", [token, pour]);
      expect(again).toBe(3);
    });

    it("rejects out-of-stock, inactive, unknown products and bad quantities", async () => {
      const token = newToken();
      await expect(
        asAnon("select public.add_to_cart($1, $2, 1)", [token, await productId("linen-throw-blanket")]),
      ).rejects.toThrow(/OUT_OF_STOCK/);
      await expect(asAnon("select public.add_to_cart($1, $2, 1)", [token, randomUUID()])).rejects.toThrow(/PRODUCT_NOT_FOUND/);
      await db.query("update public.products set is_active = false where slug = 'wool-beanie'");
      await expect(
        asAnon("select public.add_to_cart($1, $2, 1)", [token, await productId("wool-beanie")]),
      ).rejects.toThrow(/PRODUCT_NOT_FOUND/);
      for (const qty of [0, 100, -1]) {
        await expect(
          asAnon("select public.add_to_cart($1, $2, $3)", [token, await productId("classic-white-tee"), qty]),
        ).rejects.toThrow(/INVALID_QUANTITY/);
      }
      // A failed add must not leave an empty cart behind.
      expect((await db.query("select count(*)::int n from public.carts")).rows[0].n).toBe(0);
    });

    it("updates quantity within stock and rejects increases beyond it", async () => {
      const token = newToken();
      const lamp = await productId("minimal-desk-lamp"); // stock 25
      await asAnon("select public.add_to_cart($1, $2, 1)", [token, lamp]);
      await asAnon("select public.set_cart_item_quantity($1, $2, 4)", [token, lamp]);
      expect((await cart(token))[0].quantity).toBe(4);

      await expect(asAnon("select public.set_cart_item_quantity($1, $2, 26)", [token, lamp])).rejects.toThrow(/INSUFFICIENT_STOCK/);
      await expect(asAnon("select public.set_cart_item_quantity($1, $2, 0)", [token, lamp])).rejects.toThrow(/INVALID_QUANTITY/);
      await expect(
        asAnon("select public.set_cart_item_quantity($1, $2, 1)", [token, await productId("wool-beanie")]),
      ).rejects.toThrow(/ITEM_NOT_IN_CART/);
    });

    it("allows reducing a quantity after stock dropped below it", async () => {
      const token = newToken();
      const lamp = await productId("minimal-desk-lamp");
      await asAnon("select public.add_to_cart($1, $2, 10)", [token, lamp]);
      await db.query("update public.products set stock = 2 where slug = 'minimal-desk-lamp'");
      const [row] = await cart(token);
      expect(row).toMatchObject({ quantity: 10, stock: 2 });
      await asAnon("select public.set_cart_item_quantity($1, $2, 9)", [token, lamp]);
      await expect(asAnon("select public.set_cart_item_quantity($1, $2, 10)", [token, lamp])).rejects.toThrow(/INSUFFICIENT_STOCK/);
    });

    it("still returns deactivated products so the UI can flag them", async () => {
      const token = newToken();
      await asAnon("select public.add_to_cart($1, $2, 1)", [token, await productId("wool-beanie")]);
      await db.query("update public.products set is_active = false where slug = 'wool-beanie'");
      expect(await cart(token)).toEqual([expect.objectContaining({ slug: "wool-beanie", is_active: false })]);
    });

    it("removes items idempotently", async () => {
      const token = newToken();
      const tee = await productId("classic-white-tee");
      const tote = await productId("canvas-tote-bag");
      await asAnon("select public.add_to_cart($1, $2, 1)", [token, tee]);
      await asAnon("select public.add_to_cart($1, $2, 1)", [token, tote]);
      await asAnon("select public.remove_cart_item($1, $2)", [token, tee]);
      await asAnon("select public.remove_cart_item($1, $2)", [token, tee]);
      expect((await cart(token)).map((r) => r.slug)).toEqual(["canvas-tote-bag"]);
      await asAnon("select public.remove_cart_item($1, $2)", [newToken(), tote]); // unknown cart: no-op
    });

    it("isolates carts between tokens", async () => {
      const alice = newToken();
      const bob = newToken();
      const tee = await productId("classic-white-tee");
      await asAnon("select public.add_to_cart($1, $2, 2)", [alice, tee]);

      expect(await cart(bob)).toEqual([]);
      await asAnon("select public.remove_cart_item($1, $2)", [bob, tee]);
      await expect(asAnon("select public.set_cart_item_quantity($1, $2, 1)", [bob, tee])).rejects.toThrow(/ITEM_NOT_IN_CART/);
      expect((await cart(alice))[0].quantity).toBe(2);
    });

    it("handles concurrent adds to the same cart without losing updates", async () => {
      const token = newToken();
      const tee = await productId("classic-white-tee");
      await asAnon("select public.add_to_cart($1, $2, 1)", [token, tee]);
      const url = new URL(ADMIN_URL!);
      url.pathname = `/${dbName}`;
      await Promise.all(
        Array.from({ length: 5 }, async () => {
          const c = new Client({ connectionString: url.toString() });
          await c.connect();
          try {
            await c.query("set role anon");
            await c.query("select public.add_to_cart($1, $2, 1)", [token, tee]);
          } finally {
            await c.end();
          }
        }),
      );
      expect((await cart(token))[0].quantity).toBe(6);
    });
  });
});
