# 06 — Caching

Caching is the single biggest performance lever in Hydrogen. Without it, every page view makes a live Storefront API call. With it, responses are served from the edge in milliseconds.

## How the Cache Works

```
Request → Oxygen Edge Worker
              │
              ▼
     Check Edge Cache (caches.open('hydrogen'))
              │
     ┌────── Cache HIT ──────┐    ┌──── Cache MISS ────┐
     │                       │    │                    │
     ▼                       │    ▼                    │
Serve stale response         │  Fetch from Shopify     │
  + background revalidate ───┘  Write to cache ────────┘
  (stale-while-revalidate)      Serve response
```

The `Cache-Status` response header tells you: `hit`, `miss`, or `stale`.

## Built-in Cache Strategies

Hydrogen ships four strategies out of the box:

| Strategy | Cache-Control Header | Effective TTL |
|----------|---------------------|---------------|
| `CacheShort()` | `public, max-age=1, stale-while-revalidate=9` | ~10 seconds |
| `CacheLong()` | `public, max-age=3600, stale-while-revalidate=82800` | ~1 day |
| `CacheNone()` | `no-store` | Never cached |
| `CacheCustom({...})` | User-defined | Custom |

**Default** (when no cache option is passed): `public, max-age=1, stale-while-revalidate=86399`

## Applying Cache Strategies

### Subrequest Caching (per query)

```ts
// Cache a single GraphQL query at the edge
const { product } = await context.storefront.query(PRODUCT_QUERY, {
  variables: { handle: params.handle },
  cache: context.storefront.CacheLong(),   // ← cache this response for ~1 hour
});
```

### Full-Page Caching (response headers)

Set cache headers on the route response to control browser and CDN caching:

```ts
export async function loader({ context }: Route.LoaderArgs) {
  const data = await loadData(context);

  // Return with cache headers
  return data;                             // React Router sets default cache headers
  // OR: return new Response(JSON.stringify(data), {
  //   headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' }
  // });
}
```

## Choosing the Right Strategy

| Data Type | Strategy | Why |
|-----------|----------|-----|
| Product catalog, collections | `CacheLong()` | Changes rarely, safe to cache 1 day |
| Homepage featured items | `CacheLong()` | Same — catalog data |
| Blog posts | `CacheLong()` | Content changes infrequently |
| Prices during sale | `CacheShort()` | Changes more often |
| Cart | `CacheNone()` | Always user-specific |
| Customer account data | `CacheNone()` | Always user-specific — **never cache** |
| Sitemap | `CacheLong()` | Regenerate daily max |
| Search results | `CacheShort()` | Varies by query |

## Custom Cache Strategy

Fine-tune every dimension:

```ts
import { CacheCustom } from '@shopify/hydrogen';

const { products } = await context.storefront.query(PRODUCTS_QUERY, {
  cache: CacheCustom({
    mode: 'public',
    maxAge: 60,                  // serve fresh for 60 seconds
    staleWhileRevalidate: 600,   // then serve stale for 10 min while fetching fresh
    staleIfError: 3600,          // on API error, serve stale for up to 1 hour
    sMaxAge: 300,                // CDN/proxy cache for 5 minutes
  }),
});
```

### `CacheCustom` Options

| Option | Type | Description |
|--------|------|-------------|
| `mode` | string | `public`, `private`, `no-store`, `must-revalidate`, `no-transform` |
| `maxAge` | number | Seconds to serve as fresh |
| `staleWhileRevalidate` | number | Seconds to serve stale while background-fetching |
| `sMaxAge` | number | Seconds shared caches (CDN) can store the response |
| `staleIfError` | number | Seconds to serve stale on 5xx upstream errors |

> `no-cache` is **not supported** — Oxygen doesn't return `304 Not Modified`, so the directive has no effect.

## Stale-While-Revalidate Explained

```
t=0s   User A requests /products/shirt
         → cache MISS → fetches from Shopify (100ms)
         → response served + written to cache (maxAge=1, SWR=9)

t=1s   User B requests /products/shirt
         → cache fresh → served instantly from cache (0ms)

t=2s   User C requests /products/shirt
         → cache STALE (past maxAge=1, within SWR=9)
         → served from stale cache instantly (0ms)
         → background: Oxygen fetches fresh data, updates cache

t=2.1s Fresh data written to cache for next user
```

This gives you the speed of static generation and the freshness of dynamic rendering simultaneously.

## Customer Data — Critical Security Rule

**Never cache customer-specific data.** Shared caches (CDN, edge) will serve cached HTML to other users, exposing PII.

```ts
// ✅ CORRECT — customer data
const { customer } = await context.storefront.query(CUSTOMER_QUERY, {
  variables: { customerAccessToken: session.get('customerAccessToken') },
  cache: context.storefront.CacheNone(),    // ← required
});

// ✅ CORRECT — customer account API
// The customer account API never caches by default

// ❌ WRONG — this would cache customer data at the edge
const { customer } = await context.storefront.query(CUSTOMER_QUERY, {
  variables: { ... },
  cache: context.storefront.CacheLong(),   // ← NEVER do this for customer data
});
```

Also set the response header to `private` on account routes:

```ts
// In account route loaders
return new Response(JSON.stringify(data), {
  headers: {
    'Cache-Control': 'private, max-age=0',
    'Content-Type': 'application/json',
  },
});
```

## Third-Party API Caching

Use `createWithCache` to apply the same caching infrastructure to any external API:

```ts
import { createWithCache, CacheLong } from '@shopify/hydrogen';

export function createCmsClient({ cache, waitUntil, request }) {
  const withCache = createWithCache({ cache, waitUntil, request });

  return {
    async getPage(slug: string) {
      const { data } = await withCache.fetch(
        `https://your-cms.io/api/pages/${slug}`,
        { headers: { Authorization: `Bearer ${CMS_TOKEN}` } },
        {
          cacheStrategy: CacheLong(),
          shouldCacheResponse: (body) => body !== null,    // don't cache errors
          cacheKey: ['cms-page', slug],                    // unique cache key
        },
      );
      return data;
    },
  };
}
```

## Cache Keys

Hydrogen automatically generates cache keys from:
- The full GraphQL query string (minified)
- The variables object
- The storefront domain + API version

For custom APIs, set explicit keys:

```ts
cacheKey: ['my-api', slug, locale]   // array gets JSON-serialised
```

## Monitoring Cache Behaviour

In development, Hydrogen logs cache hits/misses to the terminal. In production, check the `Cache-Status` response header:

```
Cache-Status: hit       ← served from cache
Cache-Status: miss      ← fetched from origin
Cache-Status: stale     ← served stale, background revalidation triggered
```

---

## Full-Page Response Caching

Subrequest caching (above) caches individual Storefront API calls inside the worker. Full-page caching goes one level higher — it caches the **entire rendered HTML response** at the Cloudflare edge so the worker itself doesn't run at all for cache hits.

### Two Distinct Cache Layers

```
Browser
  │  GET /products/cool-shirt
  ▼
Cloudflare Edge (CDN layer)
  │
  ├── Full-page cache HIT?
  │     └── YES → return cached HTML immediately, worker never runs   ← fastest
  │     └── NO  ↓
  │
  ▼
Oxygen Edge Worker runs
  │
  ├── Subrequest cache HIT?
  │     └── YES → serve from Cloudflare Cache API, no Shopify call   ← fast
  │     └── NO  → fetch from Shopify Storefront API                  ← slowest
  │
  └── Render HTML → set Cache-Control header → return Response
        ↑
        Cloudflare CDN stores this response if Cache-Control allows
```

| Layer | What it caches | Set via | Keyed by |
|---|---|---|---|
| Subrequest cache | Storefront API JSON response | `cache: CacheLong()` on `storefront.query()` | GraphQL query + variables |
| Full-page cache | Entire rendered HTML response | `Cache-Control` header on the Response | Full request URL |

### How to Set Full-Page Cache Headers

Use `generateCacheControlHeader` from `@shopify/hydrogen` to produce a correct `Cache-Control` string from the same strategy objects you already know:

```ts
// routes/catalog/products/$handle.tsx
import {generateCacheControlHeader, CacheLong, CacheShort} from '@shopify/hydrogen';
import type {Route} from './+types/$handle';

export async function loader({params, context}: Route.LoaderArgs) {
  const {storefront} = context;

  const {product} = await storefront.query(PRODUCT_QUERY, {
    variables: {handle: params.handle},
    cache: storefront.CacheLong(),   // ← subrequest cache (Storefront API call)
  });

  if (!product) throw new Response('Not found', {status: 404});

  // Return data WITH Cache-Control header on the full HTML response
  return Response.json(
    {product},
    {
      headers: {
        'Cache-Control': generateCacheControlHeader(CacheLong()),
        // → 'public, max-age=3600, stale-while-revalidate=82800'
      },
    },
  );
}
```

React Router serialises the returned `Response` headers onto the final HTTP response, so Cloudflare's CDN layer sees `Cache-Control: public, max-age=3600` and stores the full HTML for the next user.

### `generateCacheControlHeader` — What It Produces

```ts
import {generateCacheControlHeader, CacheLong, CacheShort, CacheNone, CacheCustom} from '@shopify/hydrogen';

generateCacheControlHeader(CacheShort())
// → 'public, max-age=1, stale-while-revalidate=9'

generateCacheControlHeader(CacheLong())
// → 'public, max-age=3600, stale-while-revalidate=82800'

generateCacheControlHeader(CacheNone())
// → 'no-store'

generateCacheControlHeader(CacheCustom({
  mode: 'public',
  maxAge: 60,
  staleWhileRevalidate: 600,
  staleIfError: 86400,
}))
// → 'public, max-age=60, stale-while-revalidate=600, stale-if-error=86400'
```

---

## Use Cases — When to Apply Full-Page Cache

### Product Detail Page — `CacheLong()`

Products change infrequently. Price changes and inventory updates are handled by Shopify's own cache invalidation. A 1-hour full-page cache is safe for most stores.

```ts
// routes/catalog/products/$handle.tsx
export async function loader({params, context}: Route.LoaderArgs) {
  const {storefront} = context;

  const {product} = await storefront.query(PRODUCT_QUERY, {
    variables: {handle: params.handle, selectedOptions: getSelectedProductOptions(request)},
    cache: storefront.CacheLong(),  // subrequest cache
  });

  if (!product) throw new Response('Not found', {status: 404});

  return Response.json(
    {product},
    {
      headers: {
        'Cache-Control': generateCacheControlHeader(CacheLong()),
      },
    },
  );
}
```

**Result:** First visitor pays ~100ms for the Shopify API call. Every subsequent visitor in the same Cloudflare datacenter gets the full HTML in <10ms. The worker doesn't even run.

---

### Collection Page — `CacheShort()` with pagination awareness

Collections pages depend on pagination cursors (`?cursor=abc`) in the URL. Cloudflare's full-page cache keys on the full URL including query string, so each paginated page is cached independently. Use `CacheShort` because product availability in a collection changes more often than individual product data.

```ts
// routes/catalog/collections/$handle.tsx
export async function loader({params, request, context}: Route.LoaderArgs) {
  const {storefront} = context;
  const paginationVariables = getPaginationVariables(request, {pageBy: 8});

  const {collection} = await storefront.query(COLLECTION_QUERY, {
    variables: {handle: params.handle, ...paginationVariables},
    cache: storefront.CacheShort(),  // subrequest: fresh for ~10s
  });

  if (!collection) throw new Response('Not found', {status: 404});

  return Response.json(
    {collection},
    {
      headers: {
        'Cache-Control': generateCacheControlHeader(CacheShort()),
        // → 'public, max-age=1, stale-while-revalidate=9'
      },
    },
  );
}
```

---

### Homepage — `CacheLong()` with short SWR

The homepage typically shows featured products and collections — stable content. Cache the full page for an hour and allow stale serving while revalidating in the background.

```ts
// routes/home/index.tsx
export async function loader({context}: Route.LoaderArgs) {
  const {storefront} = context;

  const {collections} = await storefront.query(HOMEPAGE_QUERY, {
    cache: storefront.CacheLong(),
  });

  return Response.json(
    {collections},
    {
      headers: {
        'Cache-Control': generateCacheControlHeader(CacheLong()),
      },
    },
  );
}
```

---

### Blog / Article Pages — `CacheLong()`

Blog content almost never changes after publication. Aggressively cache it.

```ts
// routes/content/blogs/$blogHandle/$articleHandle.tsx
export async function loader({params, context}: Route.LoaderArgs) {
  const {storefront} = context;

  const {blog} = await storefront.query(ARTICLE_QUERY, {
    variables: {blogHandle: params.blogHandle, articleHandle: params.articleHandle},
    cache: storefront.CacheLong(),
  });

  return Response.json(
    {article: blog?.articleByHandle},
    {
      headers: {
        'Cache-Control': generateCacheControlHeader(CacheLong()),
      },
    },
  );
}
```

---

### Search Results — `CacheShort()` keyed by query

Search results vary by query string. Cloudflare caches each unique URL (`/search?q=shirt`, `/search?q=shoes`) separately. Use `CacheShort` because inventory and product availability changes affect relevance.

```ts
// routes/catalog/search.tsx
export async function loader({request, context}: Route.LoaderArgs) {
  const {storefront} = context;
  const url = new URL(request.url);
  const query = url.searchParams.get('q') ?? '';

  const {products} = await storefront.query(SEARCH_QUERY, {
    variables: {query},
    cache: storefront.CacheShort(),
  });

  return Response.json(
    {products, query},
    {
      headers: {
        'Cache-Control': generateCacheControlHeader(CacheShort()),
        // Vary on the search query so different searches don't collide
        Vary: 'Accept-Language',
      },
    },
  );
}
```

---

### Policy Pages — `CacheCustom` with long TTL

Legal/policy pages are static. Cache them aggressively with a long `stale-if-error` so a Shopify outage doesn't take down your policy pages.

```ts
// routes/content/policies/$handle.tsx
export async function loader({params, context}: Route.LoaderArgs) {
  const {storefront} = context;

  const {shop} = await storefront.query(POLICY_QUERY, {
    variables: {handle: params.handle},
    cache: storefront.CacheLong(),
  });

  return Response.json(
    {policy: shop?.privacyPolicy},  // or whichever policy
    {
      headers: {
        'Cache-Control': generateCacheControlHeader(
          CacheCustom({
            mode: 'public',
            maxAge: 86400,            // 24 hours fresh
            staleWhileRevalidate: 86400,
            staleIfError: 604800,     // serve stale for 7 days if Shopify is down
          }),
        ),
      },
    },
  );
}
```

---

### Sitemap — `CacheLong()`

Sitemaps are read by crawlers, not customers. Cache them hard.

```ts
// routes/system/sitemap-index.tsx
export async function loader({context, request}: Route.LoaderArgs) {
  const sitemap = await getSitemapIndex({storefront: context.storefront, request});

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': generateCacheControlHeader(CacheLong()),
    },
  });
}
```

---

### Account / Cart — `CacheNone()` — never cache

User-specific pages must never be cached at the CDN level. If they were, User A's cart or account page would be served to User B.

```ts
// routes/account/orders/index.tsx
export async function loader({context}: Route.LoaderArgs) {
  const {customerAccount} = context;

  await customerAccount.handleAuthStatus(); // redirects if not logged in

  const {data} = await customerAccount.query(ORDERS_QUERY);

  return Response.json(
    {orders: data.customer.orders},
    {
      headers: {
        'Cache-Control': 'no-store',  // or generateCacheControlHeader(CacheNone())
      },
    },
  );
}
```

```ts
// routes/cart/index.tsx — cart is always user-specific
export async function loader({context}: Route.LoaderArgs) {
  return Response.json(
    {cart: await context.cart.get()},
    {
      headers: {'Cache-Control': 'no-store'},
    },
  );
}
```

---

## Full Strategy Reference by Route Type

| Route | Full-page strategy | Why |
|---|---|---|
| `/` Homepage | `CacheLong()` | Featured products/collections rarely change |
| `/products/:handle` | `CacheLong()` | Product data is stable |
| `/collections` | `CacheShort()` | Inventory availability changes more often |
| `/collections/:handle` | `CacheShort()` | Same — collection product list changes |
| `/collections/all` | `CacheShort()` | Large catalogue, changes often |
| `/search` | `CacheShort()` | Results depend on live inventory |
| `/blogs` / `/blogs/:handle` | `CacheLong()` | Content rarely changes |
| `/blogs/:blog/:article` | `CacheLong()` | Effectively static after publish |
| `/pages/:handle` | `CacheLong()` | CMS pages are static |
| `/policies/:handle` | `CacheCustom` long TTL | Legal pages almost never change |
| `/sitemap.xml` | `CacheLong()` | Crawlers, not real users |
| `/cart` | `CacheNone()` | Always user-specific |
| `/account/*` | `CacheNone()` | Always user-specific — never cache |
| `/account/login` | `CacheNone()` | Auth flow, never cache |
| `/discount/:code` | `CacheNone()` | Discount application is transactional |

---

## How Cloudflare Uses the Cache-Control Header

When your loader returns `Cache-Control: public, max-age=3600, stale-while-revalidate=82800`:

```
1. Cloudflare receives the response from your worker
2. Sees 'public' → eligible to cache at the CDN layer
3. Stores the full HTML (or JSON for data requests) in the edge datacenter
4. For the next 3600 seconds: returns cached copy, worker never runs
5. After 3600s: response is stale — Cloudflare serves stale copy immediately
   and triggers a background revalidation request to your worker
6. Worker runs again, returns fresh HTML, Cloudflare updates the cache
7. After 3600 + 82800 seconds (total ~24h): cache entry expires entirely
```

**`public` vs `private`:**

```
Cache-Control: public   → Cloudflare CDN + browser can cache it
Cache-Control: private  → only the browser caches it, CDN skips
Cache-Control: no-store → nobody caches it
```

For account/cart pages, always use `no-store` or `private`. If you use `public` on a page that contains customer data, Cloudflare will serve that cached page to the next user who hits the same URL — a data leak.

---

## Vary Header — Cache Segmentation

By default Cloudflare caches one version per URL. If your pages differ by locale, currency, or user agent, add a `Vary` header to segment the cache:

```ts
return Response.json(data, {
  headers: {
    'Cache-Control': generateCacheControlHeader(CacheLong()),
    'Vary': 'Accept-Language',  // separate cache entry per language header
  },
});
```

In practice, Hydrogen handles locale via the URL path (`/en-us/products/shirt` vs `/fr-fr/products/shirt`) so `Vary` on `Accept-Language` is rarely needed — the URL already differentiates them.

---

## Debugging Full-Page Cache in Production

Add this to your `server.ts` to expose cache diagnostics headers:

```ts
// server.ts
const response = await handleRequest(request);

// Copy Cloudflare's cache status into the response for debugging
const cacheStatus = response.headers.get('CF-Cache-Status');
if (cacheStatus) {
  response.headers.set('X-Cache-Status', cacheStatus);
}

return response;
```

Then inspect headers in DevTools or curl:

```bash
curl -I https://yourstore.myshopify.com/products/cool-shirt

# Response headers:
# Cache-Control: public, max-age=3600, stale-while-revalidate=82800
# CF-Cache-Status: HIT          ← served from Cloudflare edge
# Age: 142                      ← cached 142 seconds ago
```

| `CF-Cache-Status` | Meaning |
|---|---|
| `HIT` | Served from Cloudflare cache — worker did not run |
| `MISS` | Not in cache — worker ran, response now being cached |
| `EXPIRED` | Was cached, TTL expired — worker ran to revalidate |
| `STALE` | Served stale — background revalidation triggered |
| `BYPASS` | Caching bypassed (e.g. `Cache-Control: no-store`) |
| `DYNAMIC` | Cloudflare determined the response is dynamic — not cached |
