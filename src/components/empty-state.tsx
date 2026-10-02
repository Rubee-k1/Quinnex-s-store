import Link from "next/link";

type Props = { title: string; description?: string; action?: { href: string; label: string } };

export function EmptyState({ title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-16 text-center">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      {description && <p className="mt-2 max-w-sm text-sm text-neutral-600">{description}</p>}
      {action && (
        <Link
          href={action.href}
          className="mt-6 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
