import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { ProductWithCategory } from "@/lib/types/database";
import { LinkPendingOverlay } from "./link-pending-overlay";
import { ProductImage } from "./product-image";

export function ProductCard({ product }: { product: ProductWithCategory }) {
  const soldOut = product.stock < 1;
  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-neutral-900"
    >
      <div className="relative aspect-square overflow-hidden">
        <ProductImage
          src={product.image_url}
          alt={product.name}
          className="size-full transition-transform duration-300 group-hover:scale-105"
        />
        <LinkPendingOverlay />
        {soldOut && (
          <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-red-700">
            Out of stock
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
        <span className="text-xs uppercase tracking-wide text-neutral-500">{product.category.name}</span>
        <h3 className="text-sm font-medium text-neutral-900 sm:text-base">{product.name}</h3>
        <div className="mt-auto flex items-baseline justify-between gap-2 pt-1">
          <p className="text-sm font-semibold text-neutral-900">{formatMoney(product.price_cents, product.currency)}</p>
          {!soldOut && product.stock <= 5 && <p className="text-xs text-amber-700">Only {product.stock} left</p>}
        </div>
      </div>
    </Link>
  );
}

export function ProductGrid({ products }: { products: ProductWithCategory[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <li key={p.id}>
          <ProductCard product={p} />
        </li>
      ))}
    </ul>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading products">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="aspect-square animate-pulse bg-neutral-100" />
          <div className="space-y-2 p-4">
            <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-100" />
            <div className="h-4 w-1/4 animate-pulse rounded bg-neutral-100" />
          </div>
        </li>
      ))}
    </ul>
  );
}
