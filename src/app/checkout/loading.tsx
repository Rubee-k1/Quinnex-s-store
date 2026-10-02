export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading checkout">
      <div className="h-8 w-40 animate-pulse rounded bg-neutral-200" />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="h-96 animate-pulse rounded-xl bg-neutral-200" />
        <div className="h-64 animate-pulse rounded-xl bg-neutral-200" />
      </div>
    </div>
  );
}
