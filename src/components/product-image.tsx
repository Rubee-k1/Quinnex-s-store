"use client";

import { useState } from "react";

type Props = { src: string | null; alt: string; className?: string; priority?: boolean };

/**
 * Product images come from the database and may be hosted anywhere, so a plain
 * <img> is used rather than next/image (which requires every host to be
 * allow-listed in next.config). Falls back to a placeholder if loading fails.
 */
export function ProductImage({ src, alt, className = "", priority = false }: Props) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`flex items-center justify-center bg-neutral-100 text-xs text-neutral-400 ${className}`} role="img" aria-label={alt || "No image"}>
        No image
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
      className={`bg-neutral-100 object-cover ${className}`}
    />
  );
}
