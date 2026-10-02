import { formatMoney } from "@/lib/money";
import { ProductImage } from "./product-image";

type Line = {
  key: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  imageUrl?: string | null;
};

type Props = {
  title?: string;
  lines: Line[];
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  note?: string;
};

export function OrderSummary({ title = "Order summary", lines, currency, subtotalCents, shippingCents, totalCents, note }: Props) {
  const money = (c: number) => formatMoney(c, currency);
  return (
    <section aria-label={title} className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
      <ul className="space-y-3">
        {lines.map((l) => (
          <li key={l.key} className="flex items-center gap-3 text-sm" data-testid="summary-line">
            {l.imageUrl !== undefined && <ProductImage src={l.imageUrl} alt="" className="size-12 shrink-0 rounded-md" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-neutral-900">{l.name}</p>
              <p className="text-neutral-600">
                {l.quantity} × {money(l.unitPriceCents)}
              </p>
            </div>
            <span className="font-medium">{money(l.lineTotalCents)}</span>
          </li>
        ))}
      </ul>
      <dl className="space-y-2 border-t border-neutral-200 pt-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-neutral-600">Subtotal</dt>
          <dd data-testid="order-subtotal">{money(subtotalCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-neutral-600">Shipping</dt>
          <dd>{shippingCents === 0 ? "Free" : money(shippingCents)}</dd>
        </div>
        <div className="flex justify-between text-base font-semibold">
          <dt>Total</dt>
          <dd data-testid="order-total">{money(totalCents)}</dd>
        </div>
      </dl>
      {note && <p className="text-xs text-neutral-500">{note}</p>}
    </section>
  );
}
