import type { ReactNode } from "react";

/** Shared layout for the privacy policy and terms pages. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl space-y-6 text-sm leading-6 text-neutral-700 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-neutral-900 [&_li]:ml-5 [&_li]:list-disc [&_a]:underline">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{title}</h1>
        <p className="mt-1 text-xs text-neutral-500">Last updated: {updated}</p>
      </header>
      {children}
    </article>
  );
}

export function SupportContact({ email }: { email: string | null }) {
  return email ? (
    <a href={`mailto:${email}`}>{email}</a>
  ) : (
    <>the contact address in your order confirmation email</>
  );
}
