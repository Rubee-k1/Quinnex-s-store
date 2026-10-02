import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCartForm } from "@/components/add-to-cart-form";
import { ProductImage } from "@/components/product-image";
import { getProductBySlug } from "@/lib/data/products";
import { formatMoney } from "@/lib/money";

export async function generateMetadata({ params }: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  return product ? { title: product.name, description: product.description.slice(0, 160) } : { title: "Product not found" };
}

export default async function ProductPage({ params }: PageProps<"/products/[slug]">) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const inStock = product.stock > 0;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-neutral-500">
        <Link href="/products" className="hover:text-neutral-900">
          Shop
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/products?category=${product.category.slug}`} className="hover:text-neutral-900">
          {product.category.name}
        </Link>
      </nav>

      <div className="grid gap-6 md:grid-cols-2 md:gap-12">
        <ProductImage
          src={product.image_url}
          alt={product.name}
          priority
          className="aspect-square w-full rounded-2xl border border-neutral-200"
        />
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">{product.name}</h1>
          <p className="mt-2 text-xl font-semibold text-neutral-900">{formatMoney(product.price_cents, product.currency)}</p>
          <p className={`mt-2 text-sm ${inStock ? (product.stock <= 5 ? "text-amber-700" : "text-green-700") : "text-red-700"}`}>
            {inStock ? (product.stock <= 5 ? `Only ${product.stock} left in stock` : "In stock") : "Out of stock"}
          </p>
          <p className="mt-6 whitespace-pre-line text-sm leading-relaxed text-neutral-700 sm:text-base">{product.description}</p>
          <div className="mt-8">
            <AddToCartForm productId={product.id} maxQuantity={Math.min(product.stock, 99)} />
          </div>
        </div>
      </div>
    </div>
  );
}
