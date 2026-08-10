# 10 — Folder & File Best Practices

> Based on the actual structure of this project + production conventions.

---

## Current Project Structure (Annotated)

```
app/
├── assets/                          # Static files imported directly in code
│   └── favicon.svg
│
├── components/                      # All reusable UI components
│   ├── AddToCartButton.tsx
│   ├── Aside.tsx
│   ├── CartLineItem.tsx
│   ├── CartMain.tsx
│   ├── CartSummary.tsx
│   ├── Footer.tsx
│   ├── Header.tsx
│   ├── PageLayout.tsx               # App shell — wraps every page
│   ├── PaginatedResourceSection.tsx
│   ├── ProductForm.tsx
│   ├── ProductImage.tsx
│   ├── ProductItem.tsx              # Product card used across routes
│   ├── ProductPrice.tsx
│   ├── SearchForm.tsx
│   ├── SearchFormPredictive.tsx
│   ├── SearchResults.tsx
│   └── SearchResultsPredictive.tsx
│
├── graphql/                         # GraphQL queries/mutations by domain
│   └── customer-account/
│       ├── CustomerAddressMutations.ts
│       ├── CustomerDetailsQuery.ts
│       ├── CustomerOrderQuery.ts
│       ├── CustomerOrdersQuery.ts
│       └── CustomerUpdateMutation.ts
│
├── lib/                             # Server utilities, helpers, context
│   ├── context.ts                   # createHydrogenRouterContext
│   ├── fragments.ts                 # Shared GraphQL fragments
│   ├── i18n.ts                      # Locale / market helpers
│   ├── orderFilters.ts
│   ├── redirect.ts                  # redirectIfHandleIsLocalized
│   ├── search.ts                    # Search helpers
│   ├── session.ts                   # Cookie session class
│   └── variants.ts                  # Variant selection helpers
│
├── routes/                          # One file = one URL
│   └── (all route files)
│
├── styles/
│   ├── app.css                      # Global component styles
│   ├── reset.css                    # CSS reset
│   └── tailwind.css                 # Tailwind entry point
│
├── entry.client.tsx                 # Browser hydration entry
├── entry.server.tsx                 # Server render entry
├── root.tsx                         # App shell: Layout, ErrorBoundary, Analytics
└── routes.ts                        # Route config (flatRoutes preset)
```

---

## Rule 1 — Components: Split by Responsibility

The biggest mistake is putting everything in one flat `components/` folder as it grows. Split into layers:

```
components/
│
├── ui/                              # Pure presentational — no data fetching, no hooks
│   ├── Button.tsx                   # Accepts only props
│   ├── Badge.tsx
│   ├── Spinner.tsx
│   ├── Modal.tsx
│   └── Input.tsx
│
├── commerce/                        # Shopify-specific components
│   ├── ProductCard.tsx              # Uses Hydrogen <Image>, <Money>
│   ├── ProductForm.tsx              # Variant selector + AddToCart
│   ├── ProductPrice.tsx
│   ├── CartLineItem.tsx
│   ├── CartSummary.tsx
│   └── AddToCartButton.tsx
│
├── layout/                          # App shell components
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── PageLayout.tsx
│   └── Aside.tsx
│
├── search/                          # Search-specific
│   ├── SearchForm.tsx
│   ├── SearchFormPredictive.tsx
│   ├── SearchResults.tsx
│   └── SearchResultsPredictive.tsx
│
└── analytics/                       # Analytics subscriber components
    ├── GoogleAnalytics.tsx
    └── MetaPixel.tsx
```

**Rule:** If a component uses `context.storefront` or `useLoaderData` → it belongs in a route file or a section component, not in `ui/`.

---

## Rule 2 — GraphQL: Keep Queries Close to Where They Are Used

### Option A — Inline in Route File (current pattern, good for route-specific queries)

```tsx
// app/routes/($locale).products.$handle.tsx
const PRODUCT_QUERY = `#graphql
  query Product($handle: String!) {
    product(handle: $handle) { id title }
  }
` as const;
```

Good when: the query is only used in one route.

### Option B — `app/graphql/` folder (current pattern for Customer Account queries)

```
graphql/
├── customer-account/
│   ├── CustomerDetailsQuery.ts       ← used across multiple account routes
│   ├── CustomerOrderQuery.ts
│   └── CustomerAddressMutations.ts
│
├── storefront/                       ← add this for shared storefront queries
│   ├── ProductFragment.ts
│   ├── CollectionFragment.ts
│   └── CartFragment.ts
```

Good when: the query or fragment is shared across 2+ route files.

### Option C — `app/lib/fragments.ts` (current pattern)

For small shared fragments used everywhere (Money, Image, ProductItem):

```ts
// app/lib/fragments.ts
export const MONEY_FRAGMENT = `#graphql
  fragment Money on MoneyV2 { amount currencyCode }
`;

export const PRODUCT_ITEM_FRAGMENT = `#graphql
  ${MONEY_FRAGMENT}
  fragment ProductItem on Product {
    id handle title
    priceRange { minVariantPrice { ...Money } }
    featuredImage { url altText width height }
  }
`;
```

**Rule of thumb:**

| Query Type | Where to Put It |
|------------|----------------|
| Used in 1 route only | Bottom of that route file |
| Used in 2+ routes | `app/graphql/storefront/` or `app/lib/fragments.ts` |
| Customer Account API | `app/graphql/customer-account/` |
| Mutations | Same folder as related queries |

---

## Rule 3 — `lib/`: Server Utilities Only

`lib/` is for **server-side** helpers. Nothing in here should use `useState`, `useEffect`, or browser APIs.

```
lib/
├── context.ts          # createHydrogenRouterContext — the wiring file
├── session.ts          # AppSession class — cookie session
├── fragments.ts        # Shared GraphQL fragments
├── i18n.ts             # getLocaleFromRequest, formatLocale
├── redirect.ts         # redirectIfHandleIsLocalized
├── variants.ts         # getVariantUrl, parseAmenities
├── search.ts           # Search query builders
│
└── third-party/        # ← add this for third-party clients
    ├── createCmsClient.server.ts
    ├── createReviewsClient.server.ts
    └── createAnalyticsClient.server.ts   # server-side only, not the Analytics.Provider
```

The `.server.ts` suffix is a **naming convention** — it signals "don't import this on the client". The framework does not enforce it but it prevents confusion.

---

## Rule 4 — Routes: One Responsibility Per File

Each route file should do exactly one thing. If a route file grows beyond ~150 lines, extract components.

```tsx
// ✅ Clean route file structure
// app/routes/($locale).products.$handle.tsx

// 1. Meta (SEO)
export const meta: Route.MetaFunction = ({ data }) => [...];

// 2. Loader (server data)
export async function loader({ params, context }: Route.LoaderArgs) { ... }
async function loadCriticalData(...) { ... }
function loadDeferredData(...) { ... }

// 3. Action (mutations — if needed)
export async function action({ request, context }: Route.ActionArgs) { ... }

// 4. Default export (the page component)
export default function ProductPage() {
  const { product } = useLoaderData<typeof loader>();
  return <ProductDetails product={product} />;  // ← extracted component
}

// 5. GraphQL (at the bottom)
const PRODUCT_QUERY = `#graphql ...` as const;
```

Never mix business logic into the component — keep it in `loader`/`action`.

---

## Rule 5 — Route File Naming Cheatsheet

```
($locale)._index.tsx                  → /
($locale).products.$handle.tsx        → /products/:handle
($locale).collections.$handle.tsx     → /collections/:handle
($locale).collections._index.tsx      → /collections
($locale).account.tsx                 → layout for /account/*
($locale).account._index.tsx          → /account (default child)
($locale).account.orders._index.tsx   → /account/orders
($locale).account.orders.$id.tsx      → /account/orders/:id
($locale).account_.login.tsx          → /account/login (outside account layout)
($locale).[sitemap.xml].tsx           → /sitemap.xml
($locale).$.tsx                       → catch-all 404
[robots.txt].tsx                      → /robots.txt
```

**Key patterns:**

| Pattern | Meaning |
|---------|---------|
| `_index` | Default index — renders when no child matches |
| `$param` | Dynamic segment |
| `($param)` | Optional segment |
| `[literal]` | Escaped — use for dots/special chars in URLs |
| `_` prefix on layout | Layout route without a URL segment |
| `account_` vs `account` | `account_` = outside the `account` layout |
| `$.tsx` | Splat — matches anything |

---

## Rule 6 — Styles: Co-locate with Components

Instead of one giant `app.css`, move styles next to their component as you scale:

```
components/
├── ProductCard/
│   ├── index.tsx          # re-exports ProductCard
│   ├── ProductCard.tsx
│   └── ProductCard.css    # scoped styles
│
├── Header/
│   ├── index.tsx
│   ├── Header.tsx
│   └── Header.css
│
styles/
├── reset.css              # global reset (keep here)
├── tailwind.css           # tailwind entry (keep here)
└── tokens.css             # design tokens: --color-primary, --spacing-md
```

With Tailwind v4 (this project), most component styles live as utility classes directly in JSX — a separate CSS file is only needed for complex animations or third-party overrides.

---

## Rule 7 — Entry Files — Don't Touch Unless Necessary

```
entry.client.tsx    # Browser hydration — only customise for global client setup
entry.server.tsx    # Server render — only customise for custom streaming behaviour
```

These are boilerplate. The real server entry is `server.ts` (the Oxygen worker).

---

## Rule 8 — `public/` vs `assets/`

| | `public/` | `app/assets/` |
|--|-----------|---------------|
| Accessed via URL | Yes (`/favicon.ico`) | No |
| Imported in code | No | Yes (`import logo from '~/assets/logo.svg'`) |
| Processed by Vite | No | Yes (hashed filenames, optimised) |
| Use for | robots.txt, OG images, fonts | Icons, SVGs used in components |

---

## Recommended Production Structure

This is the target structure for a production storefront built on this project:

```
app/
├── assets/
│   ├── favicon.svg
│   └── logo.svg
│
├── components/
│   ├── ui/                          # Headless, no Shopify deps
│   │   ├── Button.tsx
│   │   ├── Badge.tsx
│   │   └── Spinner.tsx
│   ├── commerce/                    # Shopify-specific
│   │   ├── AddToCartButton.tsx
│   │   ├── CartLineItem.tsx
│   │   ├── CartMain.tsx
│   │   ├── CartSummary.tsx
│   │   ├── PaginatedResourceSection.tsx
│   │   ├── ProductForm.tsx
│   │   ├── ProductImage.tsx
│   │   ├── ProductItem.tsx
│   │   └── ProductPrice.tsx
│   ├── layout/
│   │   ├── Aside.tsx
│   │   ├── Footer.tsx
│   │   ├── Header.tsx
│   │   └── PageLayout.tsx
│   ├── search/
│   │   ├── SearchForm.tsx
│   │   ├── SearchFormPredictive.tsx
│   │   ├── SearchResults.tsx
│   │   └── SearchResultsPredictive.tsx
│   └── analytics/
│       ├── GoogleAnalytics.tsx
│       └── MetaPixel.tsx
│
├── graphql/
│   ├── customer-account/
│   │   ├── CustomerAddressMutations.ts
│   │   ├── CustomerDetailsQuery.ts
│   │   ├── CustomerOrderQuery.ts
│   │   ├── CustomerOrdersQuery.ts
│   │   └── CustomerUpdateMutation.ts
│   └── storefront/
│       ├── CartFragment.ts
│       ├── CollectionFragment.ts
│       └── ProductFragment.ts
│
├── lib/
│   ├── context.ts
│   ├── fragments.ts
│   ├── i18n.ts
│   ├── orderFilters.ts
│   ├── redirect.ts
│   ├── search.ts
│   ├── session.ts
│   ├── seo.ts                       # Structured data helpers
│   ├── variants.ts
│   └── third-party/
│       └── createCmsClient.server.ts
│
├── routes/
│   └── (all route files)
│
├── styles/
│   ├── app.css
│   ├── reset.css
│   ├── tailwind.css
│   └── tokens.css                   # CSS custom properties
│
├── entry.client.tsx
├── entry.server.tsx
├── root.tsx
└── routes.ts
```

---

## Quick Rules Summary

| Rule | Do | Don't |
|------|-----|-------|
| Components | Split by ui / commerce / layout / search | Dump everything flat in `components/` |
| GraphQL | Inline if 1 route, `graphql/` folder if shared | Scatter queries randomly |
| `lib/` | Server utilities, context, fragments | Browser hooks or UI logic |
| Route files | 1 responsibility, extract components when >150 lines | Mix data fetching and heavy UI |
| `.server.ts` suffix | Name server-only client files this way | Import server files in UI components |
| Styles | Tailwind utilities in JSX, global tokens in `tokens.css` | One giant `app.css` for everything |
| `public/` | robots.txt, sitemaps, OG images | Images that need Vite processing |
| `assets/` | SVGs, icons imported in components | Files served directly at a URL |
