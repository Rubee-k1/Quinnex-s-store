"use client";

import { useLinkStatus } from "next/link";

/** Spinner overlay shown inside a <Link> while its navigation is pending. */
export function LinkPendingOverlay() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span className="absolute inset-0 flex items-center justify-center bg-white/60" role="status" aria-label="Loading">
      <span className="size-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900" />
    </span>
  );
}
