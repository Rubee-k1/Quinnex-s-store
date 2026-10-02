"use client";

import { useState } from "react";

/** Profile picture from the identity provider, falling back to an initial. */
export function Avatar({ src, name }: { src: string | null | undefined; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="flex size-12 items-center justify-center rounded-full bg-neutral-900 text-lg font-semibold text-white" aria-hidden>
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="size-12 rounded-full bg-neutral-100" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  );
}
