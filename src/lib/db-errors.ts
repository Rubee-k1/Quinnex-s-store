/** Maps errors raised by our Postgres functions to messages safe to show users. */
export function describeDbError(error: { message?: string; code?: string } | null | undefined): string {
  const message = error?.message ?? "";
  const detail = (prefix: string) => {
    const i = message.indexOf(prefix);
    return i >= 0 ? message.slice(i + prefix.length).trim() : "";
  };

  if (message.includes("OUT_OF_STOCK")) return "Sorry, this product is out of stock.";
  if (message.includes("PRODUCT_NOT_FOUND")) return "This product is no longer available.";
  if (message.includes("INSUFFICIENT_STOCK:"))
    return `Not enough stock for ${detail("INSUFFICIENT_STOCK:")}. Please update the quantity in your cart.`;
  if (message.includes("INSUFFICIENT_STOCK")) return "Sorry, there isn't enough stock for that quantity.";
  if (message.includes("PRODUCT_UNAVAILABLE:"))
    return `${detail("PRODUCT_UNAVAILABLE:")} is no longer available. Please remove it from your cart.`;
  if (message.includes("ITEM_NOT_IN_CART")) return "That item is no longer in your cart.";
  if (message.includes("INVALID_QUANTITY")) return "Please choose a quantity between 1 and 99.";
  if (message.includes("INVALID_CART_TOKEN")) return "Your cart session is invalid. Please refresh the page.";
  if (message.includes("CART_EMPTY")) return "Your cart is empty.";
  if (message.includes("CART_CHANGED"))
    return "Your cart changed since you opened checkout. Please review the updated order summary and try again.";
  if (message.includes("MIXED_CURRENCY")) return "Items priced in different currencies can't be checked out together.";
  if (message.includes("ORDER_TOO_LARGE")) return "This order is too large to place online. Please contact us.";
  if (message.includes("IDEMPOTENCY_CONFLICT")) return "Your checkout session expired. Please reload the page.";
  if (message.includes("INVALID_INPUT")) return "Some details are invalid. Please check the form and try again.";
  return "Something went wrong. Please try again.";
}
