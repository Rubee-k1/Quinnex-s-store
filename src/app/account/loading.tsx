export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-8" aria-busy="true" aria-label="Loading account">
      <div className="h-24 animate-pulse rounded-xl bg-neutral-200" />
      <div className="h-6 w-32 animate-pulse rounded bg-neutral-200" />
      <div className="h-48 animate-pulse rounded-xl bg-neutral-200" />
    </div>
  );
}
