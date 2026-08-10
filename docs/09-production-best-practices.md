# 09 — Production Best Practices

## Performance

### 1. Split Every Loader into Critical + Deferred

Never `await` data that isn't needed for the initial paint:

```ts
// ✅ CORRECT
export async function loader(args: Route.LoaderArgs) {
  const deferredData = loadDeferredData(args);     // Promise returned immediately
  const criticalData = await loadCriticalData(args); // awaited before response starts
  return { ...deferredData, ...criticalData };
}

// ❌ WRONG — awaiting everything blocks Time to First Byte
export async function loader({ context, params }: Route.LoaderArgs) {
  const { product } = await context.storefront.query(PRODUCT_QUERY, ...);
  const { reviews } = await context.reviews.get(product.id);          // waited for product first
  const { recommendations } = await context.storefront.query(...);     // waited for reviews first
  return { product, reviews, recommendations };
}
```

### 2. Always Use `Promise.all` for Parallel Queries

```ts
// ✅ Fires both queries simultaneously
const [{ product }, { shop }] = await Promise.all([
  context.storefront.query(PRODUCT_QUERY, { variables: { handle } }),
  context.storefront.query(SHOP_QUERY),
]);

// ❌ Serial — twice as slow
const { product } = await context.storefront.query(PRODUCT_QUERY, ...);
const { shop } = await context.storefront.query(SHOP_QUERY);
```

### 3. Cache Aggressively, Invalidate Precisely

| Rule | Implementation |
|------|---------------|
| Static catalog data → `CacheLong()` | Products, collections, blog posts |
| Semi-dynamic → `CacheCustom(maxAge: 60)` | Prices during flash sales |
| User-specific → `CacheNone()` | Cart, account, wish lists |
| Third-party → wrap with `createWithCache` | CMS, reviews, search |

### 4. Image Optimisation with Hydrogen's `<Image>`

Never use raw `<img>` for Shopify CDN images:

```tsx
import { Image } from '@shopify/hydrogen';

// ✅ Correct — generates srcset, lazy loading, correct sizes
<Image
  data={product.featuredImage}
  sizes="(min-width: 768px) 50vw, 100vw"
  loading={isAboveFold ? 'eager' : 'lazy'}
/>

// ❌ Missing srcset, no CDN optimisation
<img src={product.featuredImage.url} />
```

The `<Image>` component uses Shopify's image CDN to serve correctly-sized images for every viewport.

### 5. Pagination Over Fetching All Records

Never fetch all products at once:

```ts
// ✅ Paginated — only load what's visible
const paginationVariables = getPaginationVariables(request, { pageBy: 8 });
const { collection } = await storefront.query(COLLECTION_QUERY, {
  variables: { ...paginationVariables },
});

// ❌ Fetching 250 products for a page that shows 8
const { collection } = await storefront.query(`query { collection(handle:"...") {
  products(first: 250) { nodes { ... } }
}}`);
```

## Routing Best Practices

### Locale / Market Routing

This project uses `($locale)` optional segments. Always redirect to the canonical locale URL:

```ts
// app/lib/redirect.ts pattern
export function redirectIfHandleIsLocalized(
  request: Request,
  { handle, data }: { handle: string; data: { handle: string } },
) {
  if (data.handle !== handle) {
    // The API returned a different handle (localised) — redirect to it
    const url = new URL(request.url);
    url.pathname = url.pathname.replace(handle, data.handle);
    throw redirect(url.toString(), 301);
  }
}
```

### 404 vs Storefront Redirects

In `server.ts`, after a 404, always check Shopify's redirect rules before returning the 404:

```ts
if (response.status === 404) {
  return storefrontRedirect({ request, response, storefront: hydrogenContext.storefront });
}
```

This allows merchants to manage URL redirects from the Shopify admin without code deploys.

### Cart Permalinks

Support `/cart/:lines` for sharing pre-filled carts:

```
/cart/41740089081023:2,41740089081024:1
```

The route `($locale).cart.$lines.tsx` parses the line items and creates a cart.

## Security

### Environment Variables

```ts
// env.d.ts — document every variable
interface Env {
  SESSION_SECRET: string;                    // ≥32 bytes, randomly generated
  PUBLIC_STORE_DOMAIN: string;               // safe to expose (prefix: PUBLIC_)
  PUBLIC_STOREFRONT_API_TOKEN: string;       // safe to expose
  PRIVATE_STOREFRONT_API_TOKEN?: string;     // NEVER expose — server only
  // Third-party secrets — NEVER prefix with PUBLIC_
  SANITY_API_TOKEN: string;
  CMS_API_TOKEN: string;
}
```

- `PUBLIC_` prefix → included in client bundle (safe)
- No prefix → server-only, never sent to browser

### Session Security

```ts
// context.ts — use httpOnly signed cookies
const session = await AppSession.init(request, [env.SESSION_SECRET]);
// SESSION_SECRET must be a strong random string (≥32 chars)
// Rotate it by providing multiple secrets: [newSecret, oldSecret]
```

### Never Cache Personalised Data

See [06-caching.md](./06-caching.md#customer-data--critical-security-rule) — always use `CacheNone()` for any customer-specific query.

### Input Validation in Actions

```ts
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const quantity = Number(formData.get('quantity'));

  // Validate before using
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    throw new Response('Invalid quantity', { status: 400 });
  }
  // ...
}
```

## Error Handling

### Route-Level ErrorBoundary

```tsx
// Every route that can fail should export one
import { useRouteError, isRouteErrorResponse } from 'react-router';

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) return <NotFound />;
    return <div>{error.status} — {error.statusText}</div>;
  }
  return <div>Something went wrong. Please try again.</div>;
}
```

### Global ErrorBoundary in `root.tsx`

Catches anything not handled by route-level boundaries.

### Never Let Deferred Data Crash the Page

```ts
function loadDeferredData({ context }: Route.LoaderArgs) {
  const recommendations = context.storefront
    .query(RECOMMENDATIONS_QUERY)
    .catch((error) => {
      console.error(error);    // log but don't rethrow
      return null;             // component handles null gracefully
    });
  return { recommendations };
}
```

## TypeScript

### Codegen — Always Use Generated Types

Run `shopify hydrogen dev` — codegen runs automatically when `.tsx` files are saved.

```ts
import type { ProductDetailsFragment } from 'storefrontapi.generated';

// ✅ Fully typed
function ProductCard({ product }: { product: ProductDetailsFragment }) { ... }

// ❌ Any — loses type safety
function ProductCard({ product }: { product: any }) { ... }
```

### Route Type Safety

Every route file gets auto-generated types in `+types/`:

```ts
import type { Route } from './+types/products.$handle';

// Fully typed loader args + return value
export async function loader({ params, context }: Route.LoaderArgs) { ... }
export const meta: Route.MetaFunction = ({ data }) => [...];
```

## SEO

### Structured Data (JSON-LD)

```tsx
export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.product.title} | My Store` },
  { name: 'description', content: data?.product.seo?.description },
  { tagName: 'script', type: 'application/ld+json', children: JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: data?.product.title,
    image: data?.product.featuredImage?.url,
    offers: {
      '@type': 'Offer',
      price: data?.product.priceRange.minVariantPrice.amount,
      priceCurrency: data?.product.priceRange.minVariantPrice.currencyCode,
    },
  })},
];
```

### Sitemap

Return XML from a route:

```ts
// app/routes/($locale).[sitemap.xml].tsx
export async function loader({ context }: Route.LoaderArgs) {
  const { products } = await context.storefront.query(SITEMAP_QUERY, {
    cache: context.storefront.CacheLong(),
  });

  const xml = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${products.nodes.map((p) => `<url><loc>https://your-store.com/products/${p.handle}</loc></url>`).join('')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' },
  });
}
```

## Deployment Checklist

- [ ] All `PUBLIC_` env vars set in Oxygen dashboard
- [ ] `SESSION_SECRET` is a strong random string (≥32 chars)
- [ ] Third-party API tokens set as private env vars (no `PUBLIC_` prefix)
- [ ] Cache strategies reviewed — customer data uses `CacheNone()`
- [ ] `ErrorBoundary` exported from every critical route
- [ ] Deferred data uses `.catch()` so errors don't crash the page
- [ ] `<Image>` used for all Shopify CDN images
- [ ] Pagination implemented — no unbounded `first: 250` queries
- [ ] `sitemap.xml` route returns up-to-date XML
- [ ] Analytics.Provider in root.tsx with consent configured
- [ ] TypeScript codegen output (`storefrontapi.generated.d.ts`) committed

## Oxygen Limits to Keep in Mind

| Limit | Value |
|-------|-------|
| Worker bundle size | ≤10 MB |
| Startup time | ≤400 ms |
| CPU time per request | ≤30 s |
| Memory | ≤128 MB |
| Outbound request timeout | 2 minutes |
| Custom env variables | ≤110 |

Keep your bundle small — avoid importing heavy Node.js libraries that won't run in V8 isolates. Use `ssr.optimizeDeps` in `vite.config.ts` for CJS/ESM compatibility issues.
