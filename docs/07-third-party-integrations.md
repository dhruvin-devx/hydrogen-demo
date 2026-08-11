# 07 — Third-Party Integrations

Hydrogen can integrate any third-party service that exposes an API. The key pattern is:

1. Create a **server-side client** in `app/lib/`
2. Add it to **Hydrogen context** in `app/lib/context.ts`
3. Call it in **route loaders** (in parallel with Storefront API queries)
4. Apply **caching** to avoid hammering third-party APIs

---

## Credential Isolation — Keeping API Keys Off the Browser

The single most important rule when integrating any third-party API is that **credentials (API keys, secret tokens, bearer tokens) must never reach the browser**. If a key appears in a browser Network request — even in a POST body — it is exposed to anyone who opens DevTools.

Hydrogen enforces this naturally because all `loader()` and `action()` functions run on the server. The two patterns below demonstrate this with a working implementation you can run locally.

### Live Demo

The file `review-server/index.ts` is a standalone Node.js server that simulates a third-party review API with key-based auth. The Hydrogen app calls it server-side using two different patterns.

```
# Terminal 1 — start the standalone "third-party" review server
node --experimental-strip-types review-server/index.ts

# Terminal 2 — start Hydrogen dev server
npm run dev
```

Then visit **`http://localhost:3000/reviews-demo`** and open DevTools → Network. In every browser request you will see:

| Request | From | `x-api-key` header? |
|---------|------|---------------------|
| Page HTML (`/reviews-demo`) | browser | ✗ never |
| `/api/reviews` (fetcher) | browser | ✗ never |
| `http://localhost:3001/api/reviews` | **server only** | ✓ yes |

---

### Pattern 1 — Direct server-side call in `loader()` / `action()`

Use this when you need the data **before the page renders** (above the fold, SEO-critical).

```
browser → Hydrogen (loader) → third-party API → back to browser as HTML
                  ↑
         API key injected here (server only)
```

**Implementation** (`app/routes/reviews-demo/index.tsx`):

```ts
import type {LoaderFunctionArgs, ActionFunctionArgs} from 'react-router';

export async function loader({request, context}: LoaderFunctionArgs) {
  // ⚠️  Use context.env — NOT process.env.
  //    Hydrogen runs in a Workers runtime (mini-oxygen) where process.env
  //    is undefined. Using it silently produces an empty API key, causing
  //    the upstream server to reject with 401. Hydrogen then intercepts that
  //    401 as an auth challenge and redirects to the login page.
  const {REVIEW_API_URL = 'http://localhost:3001', REVIEW_API_KEY = ''} =
    context.env as Env;

  const url = new URL(request.url);
  const productId = url.searchParams.get('productId') ?? 'the-complete-snowboard';

  const res = await fetch(
    `${REVIEW_API_URL}/api/reviews?productId=${encodeURIComponent(productId)}`,
    {headers: {'x-api-key': REVIEW_API_KEY}}, // key injected here, server-side only
  );

  const payload = await res.json();
  return {reviews: payload.reviews ?? [], productId};
}

export async function action({request, context}: ActionFunctionArgs) {
  const {REVIEW_API_URL = 'http://localhost:3001', REVIEW_API_KEY = ''} =
    context.env as Env;

  const fd = await request.formData();

  const res = await fetch(`${REVIEW_API_URL}/api/reviews`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': REVIEW_API_KEY,
    },
    body: JSON.stringify(Object.fromEntries(fd)),
  });

  return res.json();
}
```

**In the component** — a plain `<Form method="post">` triggers `action()` on the server:

```tsx
export default function ReviewsPage() {
  const {reviews} = useLoaderData<typeof loader>();

  return (
    <>
      {/* Reviews were fetched in loader — no browser network call */}
      <ReviewList reviews={reviews} />

      {/* Form POST goes to action() on server — API key stays hidden */}
      <Form method="post">
        <input name="productId" value={productId} type="hidden" />
        <input name="author" required />
        <select name="rating">{/* options */}</select>
        <textarea name="comment" required />
        <button type="submit">Submit</button>
      </Form>
    </>
  );
}
```

**When to use:**
- Page data that must be in the initial HTML (SSR / SEO)
- Form submissions that need a full-page response (redirect after POST)
- Simpler components with no need for incremental client-side updates

---

### Pattern 2 — `useFetcher` + server-side proxy route

Use this when you need to **fetch or submit data client-side without a full navigation** — e.g. loading reviews lazily, submitting without a page reload, or polling.

```
browser → /api/reviews (Hydrogen proxy) → third-party API
               ↑
      API key injected here (server only)
      Browser only ever calls /api/reviews — no key visible
```

**Step 1 — create a thin proxy route** (`app/routes/api/reviews.ts`):

```ts
import type {LoaderFunctionArgs, ActionFunctionArgs} from 'react-router';

// GET /api/reviews?productId=<handle>
export async function loader({request, context}: LoaderFunctionArgs) {
  // ⚠️  Always use context.env in Hydrogen's Workers runtime.
  //    process.env is NOT available in mini-oxygen and silently returns undefined,
  //    which causes the API key to be empty and the upstream server to reject with 401.
  const {REVIEW_API_URL = 'http://localhost:3001', REVIEW_API_KEY = ''} =
    context.env as Env;

  const url = new URL(request.url);
  const productId = url.searchParams.get('productId');
  if (!productId) return Response.json({error: 'productId required'}, {status: 400});

  const upstream = await fetch(
    `${REVIEW_API_URL}/api/reviews?productId=${encodeURIComponent(productId)}`,
    {headers: {'x-api-key': REVIEW_API_KEY}},
  );
  return Response.json(await upstream.json(), {status: upstream.status});
}

// POST /api/reviews
export async function action({request, context}: ActionFunctionArgs) {
  const {REVIEW_API_URL = 'http://localhost:3001', REVIEW_API_KEY = ''} =
    context.env as Env;

  const fd = await request.formData();
  const body = Object.fromEntries(fd.entries());
  if (body.rating) body.rating = Number(body.rating);

  const upstream = await fetch(`${REVIEW_API_URL}/api/reviews`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': REVIEW_API_KEY, // injected server-side — never reaches the browser
    },
    body: JSON.stringify(body),
  });
  return Response.json(await upstream.json(), {status: upstream.status});
}
```

**Step 2 — register the route** outside the locale wrapper in `app/routes.ts`:

```ts
export default hydrogenRoutes([
  route('api/reviews', 'routes/api/reviews.ts'), // ← before locale wrapper
  route(':locale?', '...', [...]),
]);
```

**Step 3 — use `useFetcher` in the component**:

```tsx
function FetcherReviewSection({productId}: {productId: string}) {
  const loadFetcher = useFetcher<{reviews: Review[]; total: number}>();
  const submitFetcher = useFetcher<{success?: boolean; error?: string}>();

  // Load reviews without navigating — browser calls /api/reviews (no API key visible)
  useEffect(() => {
    loadFetcher.load(`/api/reviews?productId=${encodeURIComponent(productId)}`);
  }, [productId]);

  // Reload after submit
  useEffect(() => {
    if (submitFetcher.state === 'idle' && submitFetcher.data?.success) {
      loadFetcher.load(`/api/reviews?productId=${encodeURIComponent(productId)}`);
    }
  }, [submitFetcher.state]);

  return (
    <>
      <ReviewList reviews={loadFetcher.data?.reviews ?? []} />

      {/* submitFetcher.Form posts to /api/reviews (proxy) — key stays server-side */}
      <submitFetcher.Form method="post" action="/api/reviews">
        <input type="hidden" name="productId" value={productId} />
        <input name="author" required />
        <select name="rating">{/* options */}</select>
        <textarea name="comment" required />
        <button type="submit" disabled={submitFetcher.state !== 'idle'}>
          {submitFetcher.state !== 'idle' ? 'Submitting…' : 'Submit'}
        </button>
      </submitFetcher.Form>
    </>
  );
}
```

**When to use:**
- Lazy-loaded sections (below the fold, not needed for first paint)
- Optimistic UI / instant feedback without page reload
- Polling or triggered loads (e.g. "load more", tab switch)
- Components that manage their own data lifecycle

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

These values are read via `process.env` in `loader()` / `action()` — they live only in the server bundle and are never serialised into any browser response.

---

### Pattern Comparison

| | Pattern 1 (loader/action) | Pattern 2 (fetcher + proxy) |
|-|---------------------------|------------------------------|
| **API key location** | server bundle only | server bundle only |
| **Browser sees** | rendered HTML / redirect | JSON from `/api/reviews` |
| **Initial load** | blocking (in first HTML) | lazy / on-demand |
| **Submit UX** | full-page (or redirect) | no navigation, instant |
| **Complexity** | minimal | slightly more (proxy route + fetcher) |
| **Best for** | SSR / SEO data, simple forms | lazy sections, optimistic UI |

Both patterns guarantee the API key is **never visible in any browser Network request**.

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
