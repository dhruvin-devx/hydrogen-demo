# 07 — Third-Party Integrations

Hydrogen can integrate any third-party service that exposes an API. The key pattern is:

1. Create a **server-side client** in `app/lib/`
2. Add it to **Hydrogen context** in `app/lib/context.ts`
3. Call it in **route loaders** (in parallel with Storefront API queries)
4. Apply **caching** to avoid hammering third-party APIs

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
