import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Category, ProductWithCategory } from "@/lib/types/database";
import { productSlugSchema } from "@/lib/validation";

export const PRODUCTS_PAGE_SIZE = 12;
const PRODUCT_SELECT = "*, category:categories!inner(slug, name)";

export type ProductListParams = { q?: string; categorySlug?: string; page?: number };

export type ProductList = {
  products: ProductWithCategory[];
  total: number;
  page: number;
  pageCount: number;
  /** The requested category, or null when filtering by an unknown slug. */
  category: Category | null | undefined;
};

/** Escape characters that have special meaning in ILIKE patterns / PostgREST filter syntax. */
export function escapeSearchTerm(term: string) {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`).replace(/[,()"]/g, " ");
}

export async function listCategories(): Promise<Category[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").select("*").order("sort_order").order("name");
  if (error) throw new Error(`Failed to load categories: ${error.message}`);
  return data;
}

async function getCategoryBySlug(slug: string): Promise<Category | null> {
  if (!productSlugSchema.safeParse(slug).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Failed to load category: ${error.message}`);
  return data;
}

export async function listProducts({ q, categorySlug, page = 1 }: ProductListParams = {}): Promise<ProductList> {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;

  let category: Category | null | undefined;
  if (categorySlug) {
    category = await getCategoryBySlug(categorySlug);
    if (!category) return { products: [], total: 0, page: 1, pageCount: 1, category: null };
  }

  const supabase = await createClient();
  const from = (safePage - 1) * PRODUCTS_PAGE_SIZE;
  let query = supabase
    .from("products")
    .select(PRODUCT_SELECT, { count: "exact" })
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, from + PRODUCTS_PAGE_SIZE - 1);

  if (category) query = query.eq("category_id", category.id);
  const term = q?.trim().slice(0, 100);
  if (term) {
    const pattern = `%${escapeSearchTerm(term)}%`;
    query = query.or(`name.ilike.${pattern},description.ilike.${pattern}`);
  }

  const { data, error, count } = await query;
  // PGRST103: requested range is past the end (e.g. ?page=999) — show an empty page.
  if (error && error.code !== "PGRST103") throw new Error(`Failed to load products: ${error.message}`);

  const total = count ?? 0;
  return {
    products: (data ?? []) as ProductWithCategory[],
    total,
    page: safePage,
    pageCount: Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE)),
    category,
  };
}

export async function listFeaturedProducts(limit = 8): Promise<ProductWithCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .gt("stock", 0)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load products: ${error.message}`);
  return data as ProductWithCategory[];
}

/** Returns null for malformed or unknown slugs and for inactive products. */
export async function getProductBySlug(slug: string): Promise<ProductWithCategory | null> {
  if (!productSlugSchema.safeParse(slug).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`Failed to load product: ${error.message}`);
  return data as ProductWithCategory | null;
}
