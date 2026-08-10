# 15 — Cart & Optimistic UI (Fetchers)

How the Hydrogen cart works end to end: where the cart lives, how mutations flow through React Router **fetchers**, what `useOptimisticCart` predicts (and what it deliberately doesn't), and how to extend it — grounded in this project's actual code.

## Mental Model in One Line

> `useOptimisticCart` = `structuredClone(serverCart)` + a replay of every pending `CartForm` submission read from `useFetchers()`. It predicts **structure** (quantity, lines, count); **money stays server-authoritative**; when the fetchers settle, revalidation replaces the prediction with truth.

---

## Where the Cart Lives

The cart is **server-side state in Shopify**, identified by a cart ID in a cookie/session. The worker exposes a cart handler on context:

```ts
// app/lib/context.ts → createHydrogenContext({ cart: {queryFragment: CART_QUERY_FRAGMENT} })
// context.cart: get(), addLines(), updateLines(), removeLines(), setCartId(), ...
```

Nothing cart-related lives in client state. The client only ever holds a **copy** delivered by a loader. `context.cart.get()` reads the cart-ID cookie and queries Shopify.

---

## The Full Lifecycle

```
1. root loader: cart.get() ──────────────▶ server truth → <CartMain cart={…}>
                                                              │
2. CartMain: useOptimisticCart(originalCart) ── predicted cart (server + pending)
                                                              │
3. user clicks +  ─▶ CartForm submits a fetcher (POST /cart)  │
       │                                                        ▼
       ├─ useFetchers() sees the pending submission ─▶ useOptimisticCart replays it
       │        → quantity/count update INSTANTLY (0ms), cost untouched
       │
4. /cart action: cart.updateLines() ─▶ Shopify Storefront API ─▶ authoritative cart
                                                              │
5. fetcher completes ─▶ React Router REVALIDATES loaders ─▶ root cart.get() re-runs
                                                              │
6. useFetchers() empties ─▶ useOptimisticCart returns server truth ─▶ prediction gone
```

---

## Step 1 — Loading

```ts
// app/root.tsx
return {cart: cart.get(), ...};      // deferred Promise
<PageLayout cart={data.cart} />      // → <CartMain cart={originalCart} />
```

`originalCart` is the last server-confirmed state.

## Step 2 — The Optimistic Overlay

```tsx
// app/components/CartMain.tsx
const cart = useOptimisticCart(originalCart);   // render THIS, not originalCart
```

## Step 3 — What Triggers a Mutation: `CartForm` + Fetchers

Every cart control is a `CartForm`, which is a React Router **fetcher form** posting to the `/cart` route. A fetcher submits without navigating, so the page doesn't change — only the cart mutates.

```tsx
// app/components/AddToCartButton.tsx
<CartForm route="/cart" action={CartForm.ACTIONS.LinesAdd} inputs={{lines}}>…</CartForm>

// app/components/CartLineItem.tsx (quantity +)
<CartForm fetcherKey={getUpdateKey(lineIds)} route="/cart"
          action={CartForm.ACTIONS.LinesUpdate} inputs={{lines}}>
  <button name="increase-quantity" value={nextQuantity} disabled={!!isOptimistic}>+</button>
</CartForm>
```

Submitting creates an in-flight fetcher whose `formData` encodes `{action, inputs}` — the exact thing `useOptimisticCart` reads.

## Step 3 (cont.) — Inside `useOptimisticCart`

From `@shopify/hydrogen` source (`dist/*/index.js`), abridged:

```js
function useOptimisticCart(cart) {
  const fetchers = useFetchers();                    // (a) all in-flight fetchers
  if (!fetchers?.length) return cart;                // nothing pending → server truth
  const optimisticCart = cart?.lines
    ? structuredClone(cart) : {lines:{nodes:[]}};    // (b) deep clone — never mutate loader data
  const cartLines = optimisticCart.lines.nodes;
  let isOptimistic = false;

  for (const {formData} of fetchers) {               // (c) replay each pending submission
    const {action, inputs} = CartForm.getFormInput(formData);

    if (action === 'LinesAdd') {
      for (const input of inputs.lines) {
        if (!input.selectedVariant) continue;        // (d) MUST pass selectedVariant
        const existing = cartLines.find(l => l.merchandise.id === input.selectedVariant.id);
        isOptimistic = true;
        if (existing) { existing.quantity += input.quantity||1; existing.isOptimistic = true; }
        else cartLines.unshift({                      // (e) synthesize a temp line
          id: getOptimisticLineId(input.selectedVariant.id),
          merchandise: input.selectedVariant,         // ← why merchandise.price exists on add
          isOptimistic: true, quantity: input.quantity||1,
        });
      }
    } else if (action === 'LinesRemove') { /* splice matching line */ isOptimistic = true; }
      else if (action === 'LinesUpdate') {
        cartLines[index].quantity = line.quantity;    // (f) ONLY quantity — cost NEVER touched
        if (line.quantity === 0) cartLines.splice(index,1);
        isOptimistic = true;
      }
  }

  if (isOptimistic) optimisticCart.isOptimistic = true;                 // (g) cart-level flag
  optimisticCart.totalQuantity = cartLines.reduce((s,l)=>s+l.quantity,0); // (h) recompute count
  return optimisticCart;
}
```

Mapped to things you'll hit:

| Ref | Behavior | Consequence |
|-----|----------|-------------|
| (a) | Reads `useFetchers()` | No global store; the pending form **is** the source of the prediction |
| (b) | `structuredClone` | Predicts on a copy → server data never corrupted; prediction just vanishes when fetchers clear |
| (d/e) | Add needs `input.selectedVariant` | `ProductForm` must pass it; also why `merchandise.price` is available on a fresh add |
| (f) | Update sets `quantity` only, never `cost` | **Prices go stale during the optimistic window** → the reason we add a custom price layer |
| (g/h) | Sets `cart.isOptimistic`, recomputes `totalQuantity` | Badge/count are optimistic; money is not |

## Step 4 — The Server Action (only place that calls Shopify)

```ts
// app/routes/cart/index.tsx
export async function action({request, context}) {
  const {cart} = context;
  const {action, inputs} = CartForm.getFormInput(await request.formData());
  switch (action) {
    case CartForm.ACTIONS.LinesUpdate: result = await cart.updateLines(inputs.lines); break;
    case CartForm.ACTIONS.LinesAdd:    result = await cart.addLines(inputs.lines);    break;
    case CartForm.ACTIONS.LinesRemove: result = await cart.removeLines(inputs.lineIds); break;
    // discounts, gift cards, buyer identity…
  }
  const headers = cart.setCartId(result.cart.id);        // refresh cart-id cookie
  return data({cart: result.cart, errors, warnings}, {headers});
}
```

`cart.updateLines()` → Storefront API cart mutation → authoritative cart (real prices, discounts, tax).

## Steps 5–6 — Reconciliation

When the fetcher completes, React Router **automatically revalidates loaders**. `cart.get()` re-runs → fresh cart. Now `useFetchers()` is empty, so `useOptimisticCart` returns server truth (early return). The prediction disappears, authoritative prices appear, `isOptimistic` clears, buttons re-enable.

---

## What's Optimistic by Default vs What Needs a Custom Layer

This is the key boundary.

### Optimistic for free (derivable purely from the click)

| Field | Why it's safe |
|-------|---------------|
| Line **quantity** | You submitted the number |
| Line **added / removed** | Structural |
| **`totalQuantity`** (cart badge) | Sum of quantities |
| **`merchandise`** on an added line | Comes from the `selectedVariant` you passed |
| **`isOptimistic`** flags | Set by the hook |

### NOT optimistic — server-authoritative (needs a custom layer)

| Field | Why it can't be predicted |
|-------|---------------------------|
| Line **price** (`cost.totalAmount`) | Shopify pricing engine |
| **Subtotal / totals** | Server-computed |
| **Taxes, shipping, duties** | Depend on market/address/rules |
| **Discounts / automatic discounts** | Shopify decides applicability + amount |
| Gift cards, checkout URL | Server-owned |

> **Rule of thumb:** quantity/structure = optimistic out of the box; **anything Shopify computes (especially money) you must predict yourself** if you want it instant.

---

## The Custom Price Layer (this project)

Because the hook leaves `cost` untouched on update (ref **f**), we bridge the gap with an approximation, gated on `cart.isOptimistic` so it only applies during the pending window.

```ts
// app/lib/optimisticPrice.ts
export function multiplyMoney(money: MoneyV2, quantity: number): MoneyV2 {
  const decimals = money.amount.split('.')[1]?.length ?? 2;
  return {amount: (Number(money.amount) * quantity).toFixed(decimals), currencyCode: money.currencyCode};
}
export function optimisticSubtotal(lines, fallback) {
  let total = 0, currencyCode;
  for (const line of lines) {
    const perUnit = line.cost?.amountPerQuantity ?? line.merchandise?.price; // add-line fallback
    if (!perUnit?.amount) return fallback;
    total += Number(perUnit.amount) * line.quantity; currencyCode = perUnit.currencyCode;
  }
  return currencyCode == null ? fallback : {amount: total.toFixed(2), currencyCode};
}
```

```tsx
// app/components/CartMain.tsx — thread the cart-level flag down
<CartLineItem line={line} cartIsOptimistic={Boolean(cart?.isOptimistic)} … />

// app/components/CartLineItem.tsx — line price
const perUnitPrice = line?.cost?.amountPerQuantity ?? line?.merchandise?.price;
const displayPrice =
  cartIsOptimistic && perUnitPrice
    ? multiplyMoney(perUnitPrice, line.quantity)          // predict: unit × qty
    : line?.cost?.totalAmount                              // at rest: authoritative
      ?? (perUnitPrice ? multiplyMoney(perUnitPrice, line.quantity) : undefined);

// app/components/CartSummary.tsx — subtotal
const subtotal = cart?.isOptimistic
  ? optimisticSubtotal(cart?.lines?.nodes ?? [], cart?.cost?.subtotalAmount)
  : cart?.cost?.subtotalAmount;
```

Two cases the fallback handles:

- **Quantity update** → `cost.amountPerQuantity` (server per-unit price) × optimistic quantity.
- **Fresh add** → server `cost` isn't populated yet, so fall back to `merchandise.price` (the `selectedVariant` price). Without this, the price flashes **blank** on the first add until the server responds.

> ⚠️ **This is an approximation** — `unit price × quantity` ignores cart-level/automatic discounts, volume breaks, gift cards, and taxes. That's exactly why Hydrogen keeps money authoritative by default. Gating on `cart.isOptimistic` means the wrong-ish number only ever shows for the brief pending flash, then reconciles.

---

## Concurrency Control — `fetcherKey`

```ts
// app/components/CartLineItem.tsx
function getUpdateKey(lineIds) { return [CartForm.ACTIONS.LinesUpdate, ...lineIds].join('-'); }
```

All updates to the same line share one `fetcherKey`. React Router **cancels an in-flight fetcher when a new one reuses its key**, so rapid +/− clicks supersede each other — only the last wins, preventing races and inconsistent state.

Newly added / not-yet-confirmed lines have `isOptimistic === true`, and the controls are `disabled={!!isOptimistic}` so you can't stack mutations on a line the server hasn't acknowledged.

---

## The Error / Revert Path

If the action rejects, revert is automatic — there is no manual rollback. The fetcher still **completes**, revalidation runs, `cart.get()` returns the unchanged cart, `useFetchers()` empties, and the prediction disappears.

Demo wired into `app/routes/cart/index.tsx` (remove for production):

```ts
// force a failure when a line update reaches quantity ≥ 10
if (action === CartForm.ACTIONS.LinesUpdate) {
  const lines = inputs.lines ?? [];
  if (lines.some((l) => (l.quantity ?? 0) >= 10)) {
    return data(
      {cart: await cart.get(), errors: [{message: 'DEMO: simulated failure'}], warnings: [], analytics: {cartId: null}},
      {status: 400},   // Shopify never updated → optimistic 10 reverts to 9
    );
  }
}
```

---

## How to Test (works in local dev — it's client-side)

```bash
npm run dev
```

1. DevTools → Network → throttle **Slow 3G** to stretch the optimistic window.
2. `console.log(cart)` in `CartMain` shows the boundary live: on +/− you'll see `cart.isOptimistic: true` and `quantity`/`totalQuantity` change instantly, while `cost.totalAmount` / `subtotalAmount` stay stale until the request settles.

| Scenario | Steps | Expect |
|----------|-------|--------|
| Instant qty + price | Click +/− on a line | Quantity, line price, subtotal jump immediately, then reconcile |
| First-add price | Add from PDP | Price shows immediately (variant price), no blank flash |
| Failure revert | Climb a line to 10 | Optimistically shows 10, `/cart` returns 400, snaps back to 9 |
| Concurrency | Spam +/− fast | Intermediate requests cancel; only the last applies |

> Unlike full-page caching (see [06-caching.md](./06-caching.md)), the optimistic cart is **client-side**, so all of this is fully observable with `npm run dev` — no deploy needed.

---

## Gotchas

| Gotcha | Detail |
|--------|--------|
| Money is never optimistic by default | The hook updates `quantity` only; `cost` stays stale until reconciliation |
| Add requires `selectedVariant` | Without it in the `lines` input, the optimistic line has no `merchandise` (no image/price) and the hook logs an error |
| Optimistic price ≠ real price | `unit × qty` ignores discounts/tax — gate it on `cart.isOptimistic` and let it reconcile |
| Don't mutate the cart object | The hook already `structuredClone`s; treat `cart` as read-only in render |
| Remove debug + demo code | `console.log(cart)` in `CartMain`, `console.log('cartIsOptimistic'…)` in `CartLineItem`, and the qty≥10 block in the action are for demos only |

## Official Sources

- [Hydrogen — `useOptimisticCart`](https://shopify.dev/docs/api/hydrogen/latest/hooks/useoptimisticcart)
- [Hydrogen — `CartForm`](https://shopify.dev/docs/api/hydrogen/latest/components/cartform)
- [Hydrogen — cart handler (`createCartHandler`)](https://shopify.dev/docs/api/hydrogen/latest/utilities/createcarthandler)
- [React Router — `useFetchers`](https://reactrouter.com/api/hooks/useFetchers)
