# 07 — Third-Party Integrations

Hydrogen can integrate any third-party service that exposes an API. The key pattern is:

1. Create a **server-side client** in `app/lib/`
2. Add it to **Hydrogen context** in `app/lib/context.ts`
3. Call it in **route loaders** (in parallel with Storefront API queries)
4. Apply **caching** to avoid hammering third-party APIs

---

## Credential Isolation — Keeping API Keys Off the Browser

The single most important rule when integrating any third-party API: **credentials must never reach the browser**. Hydrogen enforces this naturally — `loader()` and `action()` always run on the server. The API key lives in `context.env` and is never serialised into any browser response.

### The core principle

```
loader()  → runs on server → reads context.env → calls upstream API
action()  → runs on server → reads context.env → calls upstream API

In both cases the browser only ever receives the result — not the key.
```

This holds regardless of how the route is triggered:
- Full page load → `loader()` runs server-side
- `<Form method="post">` → `action()` runs server-side
- `useFetcher.load(...)` → route's `loader()` runs server-side
- `useFetcher.Form action="/some-route"` → that route's `action()` runs server-side

---

### Live Demo

The file `review-server/index.ts` is a standalone Node.js server simulating a third-party API with key-based auth.

```bash
# Terminal 1 — third-party review server
node --experimental-strip-types review-server/index.ts

# Terminal 2 — Hydrogen dev server
npm run dev
```

Visit `http://localhost:3000/reviews-demo` → DevTools → Network → search `x-api-key`.

| Request | Initiated by | `x-api-key` visible? |
|---------|-------------|----------------------|
| `/reviews-demo` page load | browser | ✗ |
| `/api/reviews?productId=x` (fetcher load) | browser | ✗ |
| `http://localhost:3001/api/reviews` | **server only** | ✓ (server-to-server) |

---

### Pattern 1 — `loader()` for reads, `action()` for writes

Use when you need data in the initial HTML (SSR, SEO), or want the simplest possible setup.

```
Read:   browser → loader() on server → upstream API → HTML to browser
Write:  browser <Form> → action() on server → upstream API → response
```

```ts
// app/routes/reviews-demo/index.tsx
export async function loader({request, context}: LoaderFunctionArgs) {
  // ⚠️  context.env — not process.env (undefined in Workers runtime)
  const {REVIEW_API_URL = 'http://localhost:3001', REVIEW_API_KEY = ''} =
    context.env as Env;

  const res = await fetch(`${REVIEW_API_URL}/api/reviews?productId=...`, {
    headers: {'x-api-key': REVIEW_API_KEY}, // server-side only
  });
  return {reviews: (await res.json()).reviews ?? []};
}

export async function action({request, context}: ActionFunctionArgs) {
  const {REVIEW_API_URL = 'http://localhost:3001', REVIEW_API_KEY = ''} =
    context.env as Env;
  const fd = await request.formData();

  const res = await fetch(`${REVIEW_API_URL}/api/reviews`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-api-key': REVIEW_API_KEY},
    body: JSON.stringify(Object.fromEntries(fd)),
  });
  return res.json();
}
```

```tsx
// Component — <Form> triggers action() on the server, no proxy needed
<Form method="post">
  <input type="hidden" name="productId" value={productId} />
  <input name="author" required />
  <button type="submit">Submit</button>
</Form>
```

---

### Pattern 2 — `useFetcher` without a proxy route

Use when you need lazy/client-side loading or submit without page navigation. The key insight: **`useFetcher` can target any route's `action()` via the `action` prop — that action still runs server-side**.

You do NOT need a separate proxy route just because you're using a fetcher.

```
Read:   useFetcher.load('/api/reviews') → GET resource route → server → upstream
Write:  useFetcher.Form action="/reviews-demo" → page action() → server → upstream
                                                      ↑
                               Same action() as Pattern 1 — runs on the server.
                               No proxy route, no CSRF tokens needed.
```

**Resource route for reads** (`app/routes/api/reviews.ts`) — GET only, no write action:

```ts
// Only a loader — writes go to the page's action(), not here
export async function loader({request, context}: LoaderFunctionArgs) {
  const {REVIEW_API_URL = 'http://localhost:3001', REVIEW_API_KEY = ''} =
    context.env as Env;
  const productId = new URL(request.url).searchParams.get('productId');
  const upstream = await fetch(
    `${REVIEW_API_URL}/api/reviews?productId=${productId}`,
    {headers: {'x-api-key': REVIEW_API_KEY}},
  );
  return Response.json(await upstream.json(), {status: upstream.status});
}
// No action export — there is no public write endpoint at /api/reviews
```

**Component** — reads from resource route, writes to page action:

```tsx
function FetcherReviewSection({productId}: {productId: string}) {
  const loadFetcher = useFetcher<{reviews: Review[]; total: number}>();
  const submitFetcher = useFetcher<{success?: boolean; error?: string}>();

  useEffect(() => {
    // GET — calls the /api/reviews loader server-side
    loadFetcher.load(`/api/reviews?productId=${productId}`);
  }, [productId]);

  useEffect(() => {
    if (submitFetcher.state === 'idle' && submitFetcher.data?.success) {
      loadFetcher.load(`/api/reviews?productId=${productId}`);
    }
  }, [submitFetcher.state]);

  return (
    <>
      <ReviewList reviews={loadFetcher.data?.reviews ?? []} />

      {/*
        action="/reviews-demo" → calls the reviews-demo page's action() on the server.
        The browser POSTs to /reviews-demo. The action runs server-side.
        API key is added there. No /api/reviews write endpoint exists.
      */}
      <submitFetcher.Form method="post" action="/reviews-demo">
        <input type="hidden" name="productId" value={productId} />
        <input name="author" required />
        <button type="submit">Submit</button>
      </submitFetcher.Form>
    </>
  );
}
```

**When you DO need a separate proxy route with a POST action:**
- The endpoint is called from multiple unrelated pages
- An external service (webhook, mobile app) needs to POST to it
- You intentionally want a public JSON API

For a single-page use case, skip the proxy and use the page's `action()` directly.

---

### Standalone Review Server (local dev / testing)

`review-server/index.ts` simulates a real third-party REST API. Run it once and it stays alive (in-memory storage). It demonstrates:

- API key auth via `x-api-key` header
- `GET /api/reviews?productId=<handle>` — returns reviews array
- `POST /api/reviews` with `{productId, author, rating, comment}` — creates review
- Seeded data for `the-complete-snowboard` and `demo-product`

```
# Run with Node 22+ (supports TypeScript natively via --experimental-strip-types)
node --experimental-strip-types review-server/index.ts
```

Add the credentials to `.env` so Hydrogen routes can read them at runtime:

```bash
# .env
REVIEW_API_URL=http://localhost:3001
REVIEW_API_KEY=REVIEW-API-KEY-SECRET-123
```

These values are read via `context.env` in `loader()` / `action()` — they live only in the server bundle and are never serialised into any browser response. (`process.env` does not work in the Hydrogen Workers runtime — see the pitfall section below.)

---

### Pattern Comparison

| | Pattern 1 — loader + Form | Pattern 2 — useFetcher |
|-|---------------------------|------------------------|
| **API key location** | `context.env` — server only | `context.env` — server only |
| **Reads** | SSR — in initial HTML | Lazy via `useFetcher.load('/api/reviews')` |
| **Writes** | `<Form>` → page `action()` | `useFetcher.Form action="/reviews-demo"` → same `action()` |
| **Proxy route needed?** | No | No — write goes to page action, not a proxy |
| **Extra CSRF token?** | No | No — action() is server-side by definition |
| **Submit UX** | Full page re-render | No navigation, instant feedback |
| **Best for** | SSR / SEO, simple forms | Lazy sections, optimistic UI |

Both patterns guarantee the API key is **never visible in any browser Network request**.

The only reason to create a separate route with a POST `action()` is when the endpoint must be shared across multiple pages or called by external services. For a single page, use the page's own `action()`.

---

### Common Pitfall — `process.env` vs `context.env`

> **Symptom:** `/api/reviews` returns 401, the reviews-demo page redirects to the login page.

Hydrogen runs in a **Workers runtime** (mini-oxygen in development, Oxygen in production). In this environment `process.env` does **not** exist — it is a Node.js concept. Using it silently returns `undefined`, so the API key defaults to `''`. The upstream server rejects the empty key with 401. Hydrogen's middleware then intercepts that 401 as a customer-account auth challenge and redirects to the login page.

| | Available | Safe for secrets |
|--|-----------|-----------------|
| `process.env.FOO` | ✗ (Workers runtime) | — |
| `context.env.FOO` | ✓ | ✓ (server only) |
| `import.meta.env.FOO` | Only `PUBLIC_*` vars, client bundle | ✗ — exposed in browser |

**Always use `context.env`** in Hydrogen loaders and actions:

```ts
// ✗ WRONG — undefined in Workers runtime, empty API key → upstream 401
const REVIEW_API_KEY = process.env.REVIEW_API_KEY ?? '';

// ✓ CORRECT — available in all Hydrogen environments
export async function loader({request, context}: LoaderFunctionArgs) {
  const {REVIEW_API_KEY = ''} = context.env as Env;
}
```

Declare custom env vars in `env.d.ts` so TypeScript catches missing keys:

```ts
// env.d.ts
declare global {
  interface Env {
    REVIEW_API_URL: string;
    REVIEW_API_KEY: string;
  }
}
```

---

## The Core Pattern — Cached API Client

```ts
// app/lib/createCmsClient.server.ts
import { createWithCache, CacheLong, type CachingStrategy } from '@shopify/hydrogen';

export type CmsClient = ReturnType<typeof createCmsClient>;

export function createCmsClient({
  cache,
  waitUntil,
  request,
  token,
  baseUrl,
}: {
  cache: Cache;
  waitUntil: (p: Promise<unknown>) => void;
  request: Request;
  token: string;
  baseUrl: string;
}) {
  const withCache = createWithCache({ cache, waitUntil, request });

  async function fetchWithCache<T>(
    endpoint: string,
    options: { cacheStrategy?: CachingStrategy } = {},
  ): Promise<T> {
    const url = `${baseUrl}${endpoint}`;
    const { data } = await withCache.fetch<T>(
      url,
      { headers: { Authorization: `Bearer ${token}` } },
      {
        cacheStrategy: options.cacheStrategy ?? CacheLong(),
        shouldCacheResponse: (body) => body !== null && body !== undefined,
        cacheKey: [baseUrl, endpoint],
      },
    );
    return data;
  }

  return { fetchWithCache };
}
```

## Registering in Context

```ts
// app/lib/context.ts
import { createCmsClient } from '~/lib/createCmsClient.server';

export async function createHydrogenRouterContext(
  request: Request,
  env: Env,
  executionContext: ExecutionContext,
) {
  const waitUntil = executionContext.waitUntil.bind(executionContext);
  const [cache, session] = await Promise.all([
    caches.open('hydrogen'),
    AppSession.init(request, [env.SESSION_SECRET]),
  ]);

  const hydrogenContext = createHydrogenContext({ env, request, cache, waitUntil, session });

  // Third-party clients
  const cms = createCmsClient({
    cache,
    waitUntil,
    request,
    token: env.CMS_API_TOKEN,
    baseUrl: 'https://your-cms.io/api',
  });

  return { ...hydrogenContext, cms };
}

// Extend TypeScript types so IDEs autocomplete context.cms
declare global {
  interface HydrogenAdditionalContext {
    cms: CmsClient;
  }
}
```

## Parallel Fetching in Loaders

Always fetch third-party data in parallel with Storefront API data:

```ts
export async function loader({ params, context }: Route.LoaderArgs) {
  const [{ product }, cmsContent] = await Promise.all([
    context.storefront.query(PRODUCT_QUERY, {
      variables: { handle: params.handle },
      cache: context.storefront.CacheLong(),
    }),
    context.cms.fetchWithCache(`/pages/${params.handle}`),
  ]);

  if (!product) throw new Response('Not found', { status: 404 });

  return { product, cmsContent };
}
```

## CMS Integration (Sanity / Contentful)

### Sanity

```ts
// app/lib/createSanityClient.server.ts
import { createWithCache, CacheLong } from '@shopify/hydrogen';
import { createClient } from '@sanity/client';

export function createSanityClient({ cache, waitUntil, request, projectId, dataset }) {
  const withCache = createWithCache({ cache, waitUntil, request });
  const sanity = createClient({ projectId, dataset, useCdn: false, apiVersion: '2024-01-01' });

  return {
    async fetch<T>(query: string, params?: Record<string, unknown>): Promise<T> {
      const key = JSON.stringify({ query, params });
      const { data } = await withCache.run(
        {
          cacheKey: ['sanity', key],
          cacheStrategy: CacheLong(),
          shouldCacheResult: (result) => result !== null,
        },
        async () => sanity.fetch<T>(query, params),
      );
      return data;
    },
  };
}
```

Usage in a route loader:

```ts
const [{ product }, sanityProduct] = await Promise.all([
  context.storefront.query(PRODUCT_QUERY, { variables: { handle } }),
  context.sanity.fetch(`*[_type == "product" && slug.current == $handle][0]`, { handle }),
]);
```

### Contentful (REST)

```ts
// app/lib/createContentfulClient.server.ts
export function createContentfulClient({ cache, waitUntil, request, spaceId, accessToken }) {
  const withCache = createWithCache({ cache, waitUntil, request });
  const base = `https://cdn.contentful.com/spaces/${spaceId}`;

  return {
    async getEntry<T>(entryId: string): Promise<T> {
      const { data } = await withCache.fetch<T>(
        `${base}/entries/${entryId}?access_token=${accessToken}`,
        {},
        {
          cacheStrategy: CacheLong(),
          cacheKey: ['contentful', entryId],
          shouldCacheResponse: (body) => !body?.sys?.type?.includes('Error'),
        },
      );
      return data;
    },
  };
}
```

## Third-Party GraphQL APIs

For external GraphQL endpoints, minify queries before caching to ensure consistent cache keys:

```ts
// app/lib/createGraphQLClient.server.ts
import { createWithCache, CacheLong, type CachingStrategy } from '@shopify/hydrogen';

function minifyQuery(query: string) {
  return query.replace(/\s+/g, ' ').replace(/#[^\n]*/g, '').trim();
}

export function createGraphQLClient({
  cache,
  waitUntil,
  request,
  endpoint,
  headers = {},
}: {
  cache: Cache;
  waitUntil: (p: Promise<unknown>) => void;
  request: Request;
  endpoint: string;
  headers?: Record<string, string>;
}) {
  const withCache = createWithCache({ cache, waitUntil, request });

  return {
    async query<T>(
      query: string,
      options: {
        variables?: Record<string, unknown>;
        cache?: CachingStrategy;
      } = {},
    ): Promise<T> {
      const minified = minifyQuery(query);
      const body = JSON.stringify({ query: minified, variables: options.variables });

      const { data } = await withCache.fetch<{ data: T }>(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body,
        },
        {
          cacheStrategy: options.cache ?? CacheLong(),
          shouldCacheResponse: (body) => !body?.errors,
          cacheKey: [endpoint, body],          // body contains query + variables
        },
      );
      return data.data;
    },
  };
}
```

## Review Platforms (e.g., Yotpo, Stamped)

```ts
// app/lib/createReviewsClient.server.ts
export function createReviewsClient({ cache, waitUntil, request, apiKey }) {
  const withCache = createWithCache({ cache, waitUntil, request });

  return {
    async getReviews(productId: string, page = 1) {
      const { data } = await withCache.fetch(
        `https://api.yotpo.com/v1/widget/${apiKey}/products/${productId}/reviews.json?page=${page}`,
        {},
        {
          cacheStrategy: CacheCustom({ maxAge: 300, staleWhileRevalidate: 600 }),
          cacheKey: ['reviews', productId, page],
          shouldCacheResponse: (body) => Array.isArray(body?.response?.reviews),
        },
      );
      return data?.response?.reviews ?? [];
    },
  };
}
```

## Environment Variable Management

Add all third-party credentials to `.env` and `env.d.ts`:

```bash
# .env
CMS_API_TOKEN=xxx
SANITY_PROJECT_ID=xxx
SANITY_DATASET=production
REVIEWS_API_KEY=xxx
```

```ts
// env.d.ts
interface Env {
  // ... existing Shopify vars
  CMS_API_TOKEN: string;
  SANITY_PROJECT_ID: string;
  SANITY_DATASET: string;
  REVIEWS_API_KEY: string;
}
```

Access via `env` parameter in `createHydrogenRouterContext`:

```ts
const sanity = createSanityClient({
  cache,
  waitUntil,
  request,
  projectId: env.SANITY_PROJECT_ID,
  dataset: env.SANITY_DATASET,
});
```

## `createWithCache` vs `createFetchWithCache`

| Method | Use When |
|--------|----------|
| `withCache.fetch()` | Making HTTP requests (REST, GraphQL over HTTP) |
| `withCache.run()` | Wrapping any async function (SDK calls, DB queries) |

```ts
// withCache.run — for SDK clients that don't use raw fetch
const page = await withCache.run(
  { cacheKey: ['cms', slug], cacheStrategy: CacheLong() },
  async () => sanityClient.fetch(QUERY, { slug }),
);
```

## Caching Strategy by Data Type

| Third-Party Data | Strategy | Rationale |
|-----------------|----------|-----------|
| CMS blog posts | `CacheLong()` | Changes infrequently |
| CMS landing pages | `CacheLong()` | Same |
| Product reviews | `CacheCustom(300, SWR=600)` | Changes more often |
| Inventory (external) | `CacheShort()` | Real-time is important |
| Search results | `CacheShort()` | Query-specific |
| User recommendations | `CacheNone()` | Personalised — never cache at edge |
