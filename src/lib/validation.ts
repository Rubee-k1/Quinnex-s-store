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
