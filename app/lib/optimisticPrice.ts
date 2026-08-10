import type {MoneyV2} from '@shopify/hydrogen/storefront-api-types';

/**
 * Optimistic price helpers.
 *
 * `useOptimisticCart` updates a line's `quantity` instantly but leaves all money
 * fields (`cost.totalAmount`, `subtotalAmount`, …) at their last server value,
 * because prices depend on Shopify's pricing engine. These helpers compute a
 * best-effort price from `cost.amountPerQuantity` (per-unit price) × quantity so
 * the UI can show a price that tracks quantity during the optimistic window.
 *
 * ⚠️ APPROXIMATION — this is unit price × quantity. It does NOT reflect
 * cart-level or automatic discounts, volume-break pricing, gift cards, or taxes.
 * Only use it while `cart.isOptimistic` is true; fall back to the server's
 * authoritative amounts at rest.
 */

// Money as it appears in the codegen'd cart fragment: fields are optional.
type MoneyLike = {
  amount?: string;
  currencyCode?: MoneyV2['currencyCode'];
};

/** Multiply a MoneyV2 by a quantity, preserving currency and decimal places. */
export function multiplyMoney(money: MoneyV2, quantity: number): MoneyV2 {
  const decimals = money.amount.split('.')[1]?.length ?? 2;
  return {
    amount: (Number(money.amount) * quantity).toFixed(decimals),
    currencyCode: money.currencyCode,
  };
}

type LineForSubtotal = {
  quantity: number;
  cost?: {amountPerQuantity?: MoneyLike | null} | null;
  merchandise?: {price?: MoneyLike | null} | null;
};

/**
 * Sum `amountPerQuantity × quantity` across all lines. Returns `fallback`
 * (the server subtotal) if any line is missing a per-unit price.
 */
export function optimisticSubtotal(
  lines: LineForSubtotal[],
  fallback?: MoneyLike | null,
): MoneyLike | null | undefined {
  let total = 0;
  let currencyCode: MoneyV2['currencyCode'] | null | undefined;

  for (const line of lines) {
    // Prefer server-computed per-unit cost; for freshly added lines it isn't
    // populated yet, so fall back to the merchandise (variant) price.
    const perUnit = line.cost?.amountPerQuantity ?? line.merchandise?.price;
    if (!perUnit?.amount) return fallback;
    total += Number(perUnit.amount) * line.quantity;
    currencyCode = perUnit.currencyCode;
  }

  if (currencyCode == null) return fallback;
  return {amount: total.toFixed(2), currencyCode};
}
