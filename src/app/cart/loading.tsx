export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading cart">
      <div className="h-8 w-40 animate-pulse rounded bg-neutral-200" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="h-64 animate-pulse rounded-xl bg-neutral-200" />
        <div className="h-48 animate-pulse rounded-xl bg-neutral-200" />
      </div>
    </div>
  );
}
