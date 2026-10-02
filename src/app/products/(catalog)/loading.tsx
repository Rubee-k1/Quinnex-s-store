import { ProductGridSkeleton } from "@/components/product-card";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-32 animate-pulse rounded bg-neutral-200" />
      <ProductGridSkeleton />
    </div>
  );
}
