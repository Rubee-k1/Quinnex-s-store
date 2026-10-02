import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/actions/auth";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { SubmitButton } from "@/components/submit-button";
import { displayName, requireUser } from "@/lib/auth";
import { getMyProfile, listMyOrders } from "@/lib/data/account";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "My account", robots: { index: false } };

export default async function AccountPage() {
  // The proxy already redirects signed-out visitors; this is the authoritative check.
  const user = await requireUser("/account");
  const [profile, orders] = await Promise.all([getMyProfile(user.id), listMyOrders()]);
  const name = profile?.full_name || displayName(user);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-5">
        <div className="flex items-center gap-4">
          <Avatar src={profile?.avatar_url} name={name} />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900" data-testid="account-name">{name}</h1>
            <p className="text-sm text-neutral-600" data-testid="account-email">{profile?.email ?? user.email}</p>
          </div>
        </div>
        <form action={signOut}>
          <SubmitButton variant="secondary" pendingLabel="Signing out…">Sign out</SubmitButton>
        </form>
      </section>

      <section className="space-y-4" aria-labelledby="orders-heading">
        <h2 id="orders-heading" className="text-lg font-semibold text-neutral-900">My orders</h2>
        {orders.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="Orders you place while signed in will appear here."
            action={{ href: "/products", label: "Start shopping" }}
          />
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white" aria-label="My orders">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-neutral-50">
                  <div>
                    <p className="font-medium text-neutral-900">Order #{o.order_number}</p>
                    <p className="text-sm text-neutral-600">
                      {new Date(o.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })} · {o.itemCount} item
                      {o.itemCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium capitalize text-amber-800">{o.status}</span>
                    <span className="font-semibold">{formatMoney(o.total_cents, o.currency)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
