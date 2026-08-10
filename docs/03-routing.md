# 03 — Routing

Hydrogen uses **React Router v7 file-based routing** via the `flatRoutes` convention. Each file in `app/routes/` maps to a URL segment.

## File Naming Rules

| File Name | URL | `params` |
|-----------|-----|---------|
| `_index.tsx` | `/` | — |
| `products.$handle.tsx` | `/products/cool-shirt` | `params.handle = 'cool-shirt'` |
| `($locale)._index.tsx` | `/` or `/en-us` | `params.locale = 'en-us'` or `undefined` |
| `($locale).$.tsx` | `/anything/deep` | `params['*']` |
| `[sitemap.xml].tsx` | `/sitemap.xml` | — (brackets escape dots) |
| `account/route.tsx` | Layout wrapping `/account/*` | — |
| `account._index.tsx` | `/account` | — |

## How `($locale)` Works

This project uses `($locale)` as an **optional prefix** for market/locale support:

```
($locale)._index.tsx  →  matches both:
  /                      (no locale, default market)
  /en-us                 (US English)
  /fr-ca                 (French Canadian)
```

In loaders, read the locale:

```ts
export async function loader({ params, context }: Route.LoaderArgs) {
  const locale = params.locale ?? context.storefront.i18n.language;
  // ...
}
```

Hydrogen's storefront client is already initialised with the locale from the request, so most queries automatically get the right `@inContext` values.

## Loader — Server-Side Data Fetching

Every route can export a `loader` function. It runs on the server before the component renders.

```ts
// app/routes/($locale).products.$handle.tsx
import type { Route } from './+types/products.$handle';

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const { storefront } = context;

  const { product } = await storefront.query(PRODUCT_QUERY, {
    variables: { handle: params.handle },
    cache: storefront.CacheLong(),      // edge-cached for 1 hour
  });

  if (!product) throw new Response('Not found', { status: 404 });

  return { product };
}

export default function ProductPage() {
  const { product } = useLoaderData<typeof loader>();
  return <h1>{product.title}</h1>;
}
```

**Rules:**
- `loader` only runs on the server. Never call it from the client.
- Throw a `Response` to return a specific HTTP status (404, 302, etc).
- Return plain data — React Router serialises it to JSON.

## Action — Server-Side Mutations

`action` handles `POST`, `PUT`, `DELETE` form submissions or fetch calls.

```ts
export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const cartId = formData.get('cartId') as string;

  const result = await context.cart.addLines([
    { merchandiseId: formData.get('variantId') as string, quantity: 1 },
  ]);

  return result;
}
```

Client side, use a `<Form>` or `useFetcher`:

```tsx
import { useFetcher } from 'react-router';

function AddToCart({ variantId }: { variantId: string }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" action="/cart">
      <input type="hidden" name="variantId" value={variantId} />
      <button type="submit">Add to Cart</button>
    </fetcher.Form>
  );
}
```

## Deferred Data (Streaming)

Split your loader into **critical** (above-the-fold) and **deferred** (below-the-fold) data. Hydrogen ships the critical HTML immediately and streams the rest.

```ts
// Pattern used in this project's _index.tsx and collections.$handle.tsx
export async function loader(args: Route.LoaderArgs) {
  const deferredData = loadDeferredData(args);     // does NOT await
  const criticalData = await loadCriticalData(args); // DOES await
  return { ...deferredData, ...criticalData };
}

async function loadCriticalData({ context }: Route.LoaderArgs) {
  const [{ collections }] = await Promise.all([
    context.storefront.query(FEATURED_COLLECTION_QUERY),
    // add more parallel critical queries here
  ]);
  return { featuredCollection: collections.nodes[0] };
}

function loadDeferredData({ context }: Route.LoaderArgs) {
  // .catch() so errors don't crash the page
  const recommendedProducts = context.storefront
    .query(RECOMMENDED_PRODUCTS_QUERY)
    .catch((err) => { console.error(err); return null; });

  return { recommendedProducts };  // a Promise, not a value
}
```

In the component, use `<Suspense>` + `<Await>`:

```tsx
import { Suspense } from 'react';
import { Await } from 'react-router';

function RecommendedProducts({ products }: { products: Promise<...> }) {
  return (
    <Suspense fallback={<ProductSkeleton />}>
      <Await resolve={products}>
        {(data) => data?.products.nodes.map((p) => <ProductItem key={p.id} product={p} />)}
      </Await>
    </Suspense>
  );
}
```

## Nested Routes (Layouts)

Create a folder with a `route.tsx` to share a layout across child routes:

```
app/routes/
├── ($locale).account/
│   ├── route.tsx          ← layout: renders nav + <Outlet />
│   ├── _index.tsx         ← /account (default child)
│   ├── orders._index.tsx  ← /account/orders
│   └── orders.$id.tsx     ← /account/orders/:id
```

```tsx
// app/routes/($locale).account/route.tsx
import { Outlet } from 'react-router';

export default function AccountLayout() {
  return (
    <div className="account">
      <AccountNav />
      <Outlet />     {/* child route renders here */}
    </div>
  );
}
```

## Meta Tags (SEO)

Export `meta` from any route:

```ts
export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.product.title} | My Store` },
  { name: 'description', content: data?.product.description },
  { property: 'og:image', content: data?.product.featuredImage?.url },
];
```

## Pagination

Use Hydrogen's `getPaginationVariables` + `<Pagination>`:

```ts
import { getPaginationVariables, Pagination } from '@shopify/hydrogen';

export async function loader({ request, context }: Route.LoaderArgs) {
  const paginationVariables = getPaginationVariables(request, { pageBy: 8 });
  const { collection } = await context.storefront.query(COLLECTION_QUERY, {
    variables: { handle: params.handle, ...paginationVariables },
  });
  return { collection };
}
```

```tsx
<Pagination connection={collection.products}>
  {({ nodes, NextLink, PreviousLink, isLoading }) => (
    <>
      <PreviousLink>Previous</PreviousLink>
      {nodes.map((product) => <ProductItem key={product.id} product={product} />)}
      <NextLink>Next</NextLink>
    </>
  )}
</Pagination>
```

## Route Config (`react-router.config.ts`)

```ts
import { hydrogenPreset } from '@shopify/hydrogen/react-router-preset';

export default {
  presets: [hydrogenPreset()],   // sets up flatRoutes + Oxygen SSR optimisations
} satisfies Config;
```

You can also add manual routes:

```ts
import { flatRoutes } from '@react-router/fs-routes';

export default {
  async routes(defineRoutes) {
    return [
      ...(await flatRoutes()),
      // manual routes:
      defineRoutes((route) => {
        route('/custom', 'routes/custom.tsx');
      }),
    ];
  },
} satisfies Config;
```

## 404 and Redirects

```ts
// Throw a 404
if (!product) throw new Response('Not found', { status: 404 });

// Redirect
import { redirect } from 'react-router';
if (!handle) throw redirect('/collections');

// Storefront-managed redirects (checked automatically in server.ts)
// storefrontRedirect() handles 404s → checks Shopify URL redirect rules
```
