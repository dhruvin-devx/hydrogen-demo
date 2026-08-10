# 04 — Server-Side Rendering & How It Works

## The Request Lifecycle

```
1. Browser hits Oxygen edge worker
2. server.ts: createHydrogenRouterContext() — opens cache, session, storefront client
3. createRequestHandler() — matches the URL to a route file
4. Route loader() runs on the server
5. Storefront API is queried (collocated in same datacenter = fast)
6. React SSR: renders HTML and streams it in chunks
7. Browser receives HTML (First Contentful Paint)
8. Deferred Promises resolve → more HTML chunks streamed
9. Browser hydrates — React takes over for client-side navigation
```

## `createHydrogenContext` — the Context Factory

Defined in `app/lib/context.ts`. Called once per request in `server.ts`.

```ts
// app/lib/context.ts
import {
  createHydrogenContext,
  type HydrogenSession,
} from '@shopify/hydrogen';

export async function createHydrogenRouterContext(
  request: Request,
  env: Env,
  executionContext: ExecutionContext,
) {
  const waitUntil = executionContext.waitUntil.bind(executionContext);

  const [cache, session] = await Promise.all([
    caches.open('hydrogen'),                           // Oxygen's Web Cache API
    AppSession.init(request, [env.SESSION_SECRET]),    // cookie-based session
  ]);

  const hydrogenContext = createHydrogenContext({
    env,
    request,
    cache,
    waitUntil,
    session,
    i18n: getLocaleFromRequest(request),              // market/language
    cart: { queryFragment: CART_QUERY_FRAGMENT },
  });

  return hydrogenContext;
}
```

The returned `hydrogenContext` object contains:

| Property | Type | Purpose |
|----------|------|---------|
| `storefront` | `Storefront` | Typed Storefront API client |
| `cart` | `CartHandler` | Cart CRUD operations |
| `session` | `AppSession` | Cookie session (read/write) |
| `customerAccount` | `CustomerAccount` | Customer Account API client |
| `env` | `Env` | Environment variables |
| `waitUntil` | `fn` | Keep worker alive for cache writes |

This entire object is passed to every route loader/action via `getLoadContext`.

## Loaders in Detail

A `loader` is a server-only async function. It receives:

```ts
export async function loader({
  params,       // route params: { handle: 'cool-shirt', locale: 'en-us' }
  request,      // the raw Request object
  context,      // everything from getLoadContext (storefront, cart, session, env)
}: Route.LoaderArgs) {
  // run on server only — safe to use secrets here
}
```

### Parallel Queries (Always Prefer This)

```ts
async function loadCriticalData({ context, params }: Route.LoaderArgs) {
  const [{ product }, { shop }] = await Promise.all([
    context.storefront.query(PRODUCT_QUERY, {
      variables: { handle: params.handle },
    }),
    context.storefront.query(SHOP_QUERY),
  ]);
  return { product, shop };
}
```

`Promise.all` fires both queries simultaneously. Without it, they'd execute serially — twice as slow.

## SSR + Streaming

Hydrogen uses React's **streaming SSR**. The server renders the page in chunks:

```
Stream chunk 1: <html><head>...</head><body><nav>...</nav>
                <h1>Product Title</h1>   ← critical data rendered immediately
                <!--LOADING_PLACEHOLDER--> ← deferred section placeholder

Stream chunk 2 (after Promise resolves):
                <section>Recommended Products: ...</section>
```

The browser paints the critical content immediately, then the deferred content "pops in" as the placeholder is replaced — no spinner needed for the initial paint.

### How Deferred Works Technically

```ts
// loader returns a mix of resolved values and Promises
export async function loader(args: Route.LoaderArgs) {
  const deferredData = loadDeferredData(args);     // Promise (not awaited)
  const criticalData = await loadCriticalData(args); // resolved value
  return { ...deferredData, ...criticalData };
}
```

React Router's `defer()` mechanism serialises the Promise reference into the HTML stream. When the Promise resolves on the server, it sends the resolved data as a script tag in the same HTTP response — the browser doesn't need a second round-trip.

## Actions — Server Mutations

```ts
export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'addToCart') {
    return context.cart.addLines([
      {
        merchandiseId: formData.get('variantId') as string,
        quantity: Number(formData.get('quantity')) || 1,
      },
    ]);
  }

  throw new Response('Unknown intent', { status: 400 });
}
```

Actions always run on the server. After an action completes, React Router revalidates all loaders on the page (so the cart count updates automatically).

## Sessions

Hydrogen ships a cookie-based session:

```ts
// Read
const accessToken = session.get('customerAccessToken');

// Write (marks session as pending — server.ts commits it after response)
session.set('customerAccessToken', token);

// Destroy
session.unset('customerAccessToken');
```

The session cookie is HTTP-only and signed with `SESSION_SECRET`. Never store sensitive data in plain text in sessions.

## Error Handling

### Throw HTTP Errors in Loaders

```ts
// 404 — React Router renders ErrorBoundary
if (!product) throw new Response('Not found', { status: 404 });

// 302 redirect
throw redirect('/login');
```

### ErrorBoundary

Export from any route (or `root.tsx` for a global catch-all):

```tsx
export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    return <div>{error.status} — {error.statusText}</div>;
  }
  return <div>Unexpected error</div>;
}
```

## Environment Variables

Access via `context.env` in loaders/actions:

```ts
export async function loader({ context }: Route.LoaderArgs) {
  const domain = context.env.PUBLIC_STORE_DOMAIN;
  const privateToken = context.env.PRIVATE_STOREFRONT_API_TOKEN;
  // ...
}
```

**Never** expose `PRIVATE_*` env vars to the client. They're only available in server-side code (loaders/actions/server.ts).

In `vite.config.ts`, public env vars (prefixed `PUBLIC_`) are embedded in the client bundle. Private ones never leave the worker.

## Self-Hosting (Non-Oxygen)

To run on Node.js or Express instead of Oxygen:

```ts
// server-node.ts
import { createServer } from 'node:http';
import { createRequestHandler } from '@shopify/hydrogen';
import * as serverBuild from 'virtual:react-router/server-build';
import { createHydrogenRouterContext } from './app/lib/context';

// Need to provide a cache store compatible with the Web Cache API
// or use a get/set interface for Node:
const cache = createNodeCacheStore(); // your implementation

const handler = createRequestHandler({ build: serverBuild });

createServer(async (req, res) => {
  const request = new Request(`http://${req.headers.host}${req.url}`);
  const response = await handler(request);
  // pipe response to res
}).listen(3000);
```
