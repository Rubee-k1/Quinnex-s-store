import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { ProductGrid } from "@/components/product-card";
import { listCategories, listProducts } from "@/lib/data/products";

export const metadata: Metadata = { title: "Shop" };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const params = await searchParams;
  const q = first(params.q)?.trim().slice(0, 100) || undefined;
  const categorySlug = first(params.category) || undefined;
  const page = Number(first(params.page) ?? "1") || 1;

  const [list, categories] = await Promise.all([listProducts({ q, categorySlug, page }), listCategories()]);
  const { products, total, pageCount, page: current, category } = list;

  const href = (overrides: { category?: string; page?: number }) => {
    const sp = new URLSearchParams();
    const nextCategory = "category" in overrides ? overrides.category : categorySlug;
    if (q) sp.set("q", q);
    if (nextCategory) sp.set("category", nextCategory);
    if (overrides.page && overrides.page > 1) sp.set("page", String(overrides.page));
    const s = sp.toString();
    return s ? `/products?${s}` : "/products";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">{category ? category.name : "Shop"}</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {total} product{total === 1 ? "" : "s"}
            {q ? ` matching “${q}”` : ""}
          </p>
        </div>
        <form action="/products" className="flex w-full gap-2 sm:w-auto" role="search">
          {categorySlug && <input type="hidden" name="category" value={categorySlug} />}
          <label htmlFor="q" className="sr-only">
            Search products
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search products"
            maxLength={100}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-900 sm:w-64"
          />
          <button type="submit" className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
            Search
          </button>
        </form>
      </div>

      {categories.length > 0 && (
        <nav aria-label="Categories" className="-mx-4 overflow-x-auto px-4">
          <ul className="flex gap-2">
            {[{ slug: undefined, name: "All" }, ...categories].map((c) => {
              const active = c.slug === categorySlug;
              return (
                <li key={c.slug ?? "all"}>
                  <Link
                    href={href({ category: c.slug, page: undefined })}
                    aria-current={active ? "page" : undefined}
                    className={`block whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
                      active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
                    }`}
                  >
                    {c.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {category === null ? (
        <EmptyState
          title="Category not found"
          description="That category doesn't exist. Browse all products instead."
          action={{ href: "/products", label: "View all products" }}
        />
      ) : products.length > 0 ? (
        <ProductGrid products={products} />
      ) : (
        <EmptyState
          title="No products found"
          description={q || categorySlug ? "Try a different search or category." : "Check back soon — new products are on the way."}
          action={q || categorySlug ? { href: "/products", label: "Clear filters" } : undefined}
        />
      )}

      {pageCount > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-center gap-4 pt-4 text-sm">
          {current > 1 ? (
            <Link href={href({ page: current - 1 })} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50">
              ← Previous
            </Link>
          ) : (
            <span className="px-3 py-1.5 text-neutral-300">← Previous</span>
          )}
          <span className="text-neutral-600">
            Page {current} of {pageCount}
          </span>
          {current < pageCount ? (
            <Link href={href({ page: current + 1 })} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50">
              Next →
            </Link>
          ) : (
            <span className="px-3 py-1.5 text-neutral-300">Next →</span>
          )}
        </nav>
      )}
    </div>
  );
}
