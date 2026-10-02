"use client";

import { useEffect } from "react";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // ConfigError messages are safe and actionable; other errors are masked in production by Next.js.
  const isConfig = error.name === "ConfigError" || error.message.includes("is not configured");

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold text-neutral-900">
        {isConfig ? "Store is not configured yet" : "Something went wrong"}
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        {isConfig ? error.message : "We couldn't load this page. Please try again in a moment."}
      </p>
      {error.digest && <p className="mt-2 text-xs text-neutral-400">Reference: {error.digest}</p>}
      <button
        type="button"
        onClick={() => retry()}
        className="mt-6 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
      >
        Try again
      </button>
    </div>
  );
}
