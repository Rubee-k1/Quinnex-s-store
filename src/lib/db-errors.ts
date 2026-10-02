/** Maps errors raised by our Postgres functions to messages safe to show users. */
export function describeDbError(error: { message?: string; code?: string } | null | undefined): string {
  const message = error?.message ?? "";
  if (message.includes("OUT_OF_STOCK")) return "Sorry, this product is out of stock.";
  if (message.includes("PRODUCT_NOT_FOUND")) return "This product is no longer available.";
  if (message.includes("INSUFFICIENT_STOCK")) return "Sorry, there isn't enough stock for that quantity.";
  if (message.includes("ITEM_NOT_IN_CART")) return "That item is no longer in your cart.";
  if (message.includes("INVALID_QUANTITY")) return "Please choose a quantity between 1 and 99.";
  if (message.includes("INVALID_CART_TOKEN")) return "Your cart session is invalid. Please refresh the page.";
  return "Something went wrong. Please try again.";
}
