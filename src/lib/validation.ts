import { z } from "zod";

export const productIdSchema = z.uuid("Invalid product.");

export const quantitySchema = z.coerce
  .number({ error: "Quantity must be a number" })
  .int("Quantity must be a whole number")
  .min(1, "Quantity must be at least 1")
  .max(99, "Quantity must be at most 99");

export const cartItemSchema = z.object({
  productId: productIdSchema,
  quantity: quantitySchema,
});

/** Product URLs use slugs; anything else is treated as not found. */
export const productSlugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(200);

export const searchQuerySchema = z.string().trim().max(100);

const text = (max: number, missing: string) =>
  z.string({ error: missing }).trim().max(max, `Must be at most ${max} characters`);
const requiredText = (label: string, max: number) => text(max, `${label} is required`).min(1, `${label} is required`);
const optionalText = (max: number) =>
  text(max, "Invalid value")
    .optional()
    .transform((v) => (v ? v : undefined));

export const emailSchema = z
  .string({ error: "Email is required" })
  .trim()
  .min(1, "Email is required")
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(254, "Email is too long"));

/**
 * Customer details submitted at checkout. Note there are deliberately no
 * price, total or quantity fields: those are always computed by the database.
 */
export const checkoutSchema = z.object({
  idempotencyKey: z.uuid("Your checkout session expired. Please reload the page."),
  cartFingerprint: z.string().regex(/^[0-9a-f]{32}$/, "Your checkout session expired. Please reload the page."),
  email: emailSchema,
  name: requiredText("Full name", 120),
  phone: optionalText(40).refine((v) => !v || /^[+()\d\s.-]{5,40}$/.test(v), "Enter a valid phone number"),
  line1: requiredText("Address", 200),
  line2: optionalText(200),
  city: requiredText("City", 100),
  state: optionalText(100),
  postalCode: requiredText("Postal code", 20),
  country: z
    .string({ error: "Select a country" })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Select a country"),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const CHECKOUT_FIELDS = [
  "idempotencyKey",
  "cartFingerprint",
  "email",
  "name",
  "phone",
  "line1",
  "line2",
  "city",
  "state",
  "postalCode",
  "country",
] as const;

/** Flattens zod issues into { field: firstMessage }. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Read named string fields from FormData (missing fields become undefined). */
export function formValues<K extends string>(formData: FormData, keys: readonly K[]) {
  const out = {} as Record<K, string | undefined>;
  for (const key of keys) {
    const v = formData.get(key);
    out[key] = typeof v === "string" ? v : undefined;
  }
  return out;
}
