/** Formats integer minor units (e.g. cents) as a localised currency string. */
export function formatMoney(minorUnits: number, currency: string, locale = "en-US") {
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minorUnits / 10 ** digits);
}
