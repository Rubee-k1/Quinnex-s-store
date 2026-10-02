import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { signOut } from "@/actions/auth";
import { getUser } from "@/lib/auth";
import { getCart } from "@/lib/data/cart";
import { isSupabaseConfigured } from "@/lib/env";

function CartLink({ count }: { count: number | null }) {
  const label = count === null ? "Cart" : `Cart, ${count} item${count === 1 ? "" : "s"}`;
  return (
    <Link
      href="/cart"
      className="relative inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
      aria-label={label}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M6 6h15l-1.5 9h-12z M6 6 5 3H2 M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
      </svg>
      {count === null ? (
        <span className="inline-block h-3 w-3 animate-pulse rounded bg-neutral-200" aria-hidden />
      ) : (
        <span data-testid="cart-count">{count}</span>
      )}
    </Link>
  );
}

/** Streams in separately so a slow cart query never blocks the page shell. */
async function CartCount() {
  let count = 0;
  if (isSupabaseConfigured()) {
    try {
      count = (await getCart()).itemCount;
    } catch (err) {
      unstable_rethrow(err); // let Next.js handle its own control-flow errors
      // The header must never take the whole page down; pages surface errors themselves.
    }
  }
  return <CartLink count={count} />;
}

/** Signed-in state; streamed separately so auth latency never blocks the page. */
async function AuthNav() {
  let user = null;
  if (isSupabaseConfigured()) {
    try {
      user = await getUser();
    } catch (err) {
      unstable_rethrow(err);
    }
  }
  if (!user) {
    return (
      <Link href="/login" className="text-sm text-neutral-700 hover:text-neutral-900" data-testid="auth-nav">
        Sign in
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm" data-testid="auth-nav">
      <Link href="/account" className="font-medium text-neutral-900 hover:underline">
        Account
      </Link>
      <form action={signOut}>
        <button type="submit" className="text-neutral-600 hover:text-neutral-900">
          Sign out
        </button>
      </form>
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:h-16 sm:px-6">
        <Link href="/" className="text-base font-bold tracking-tight text-neutral-900 sm:text-lg">
          Quinnex
        </Link>
        <nav className="flex items-center gap-4 text-sm text-neutral-700">
          <Link href="/products" className="hover:text-neutral-900">
            Shop
          </Link>
        </nav>
        <form action="/products" role="search" className="ml-auto hidden md:block">
          <label htmlFor="header-search" className="sr-only">
            Search the shop
          </label>
          <input
            id="header-search"
            name="q"
            type="search"
            placeholder="Search the shop"
            maxLength={100}
            className="w-56 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </form>
        <div className="ml-auto flex items-center gap-3 md:ml-0">
          <Suspense fallback={<span className="h-4 w-14 animate-pulse rounded bg-neutral-200" aria-label="Loading account status" />}>
            <AuthNav />
          </Suspense>
          <Suspense fallback={<CartLink count={null} />}>
            <CartCount />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
