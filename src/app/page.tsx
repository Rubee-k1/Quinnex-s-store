import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { ProductGrid } from "@/components/product-card";
import { listCategories, listFeaturedProducts } from "@/lib/data/products";

export default async function HomePage() {
  const [featured, categories] = await Promise.all([listFeaturedProducts(8), listCategories()]);

  return (
    <div className="space-y-10 sm:space-y-14">
      <section className="rounded-2xl bg-neutral-900 px-6 py-12 text-white sm:px-12 sm:py-20">
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-400">New season</p>
        <h1 className="mt-3 max-w-xl text-3xl font-bold tracking-tight sm:text-5xl">Everyday goods, made to last.</h1>
        <p className="mt-4 max-w-md text-sm text-neutral-300 sm:text-base">
          Apparel, accessories and homeware chosen for quality and longevity.
        </p>
        <Link
          href="/products"
          className="mt-8 inline-block rounded-lg bg-white px-5 py-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-200"
        >
          Shop all products
        </Link>
      </section>

      {categories.length > 0 && (
        <section aria-labelledby="categories-heading">
          <h2 id="categories-heading" className="mb-4 text-xl font-semibold text-neutral-900 sm:text-2xl">
            Shop by category
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {categories.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/products?category=${c.slug}`}
                  className="block h-full rounded-xl border border-neutral-200 bg-white p-5 hover:border-neutral-400"
                >
                  <span className="font-semibold text-neutral-900">{c.name}</span>
                  {c.description && <span className="mt-1 block text-sm text-neutral-600">{c.description}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="latest-heading">
        <div className="mb-4 flex items-end justify-between sm:mb-6">
          <h2 id="latest-heading" className="text-xl font-semibold text-neutral-900 sm:text-2xl">
            Latest arrivals
          </h2>
          <Link href="/products" className="text-sm text-neutral-600 hover:text-neutral-900">
            View all →
          </Link>
        </div>
        {featured.length > 0 ? (
          <ProductGrid products={featured} />
        ) : (
          <EmptyState title="No products yet" description="Check back soon — new products are on the way." />
        )}
      </section>
    </div>
  );
}
