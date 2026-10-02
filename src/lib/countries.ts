/** ISO 3166-1 alpha-2 codes we ship to. Edit to match your shipping policy. */
export const SHIPPING_COUNTRIES = [
  "US", "CA", "GB", "IE", "NG", "GH", "KE", "ZA", "AU", "NZ", "DE", "FR", "NL", "BE", "ES", "IT",
  "PT", "SE", "NO", "DK", "FI", "CH", "AT", "PL", "AE", "SA", "IN", "SG", "JP", "BR", "MX",
] as const;

const names = new Intl.DisplayNames(["en"], { type: "region" });

export function countryOptions() {
  return SHIPPING_COUNTRIES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
