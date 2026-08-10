# 12 — Request Flow: server.ts, context.ts, entry.server.tsx, entry.client.tsx

This document walks through exactly what happens — at the code level — from the moment a browser sends a request to when the user sees a hydrated page. It covers every file in the chain and how sessions are attached to responses.

---

## The Full Picture

```
Browser
  │  GET /products/cool-shirt
  ▼
Cloudflare Edge Worker (closest datacenter to the user)
  │
  server.ts  ← fetch() entry point — called by Cloudflare on every request
  │
  ├─ 1. createHydrogenRouterContext()   app/lib/context.ts
  │         ├─ caches.open('hydrogen')       → Cloudflare Cache API
  │         └─ AppSession.init(request, …)   → app/lib/session.ts
  │
  ├─ 2. createRequestHandler()
  │         ├─ matches URL → routes/catalog/products/$handle.tsx
  │         ├─ runs loader()   ← reads context.storefront, context.session, etc.
  │         └─ calls entry.server.tsx → renderToReadableStream()
  │
  ├─ 3. session.commit() if isPending    → Set-Cookie header on response
  ├─ 4. storefrontRedirect() if 404      → checks Shopify redirect table
  │
  ▼
HTTP Response (streaming HTML) sent to browser
  │
  ├─ Browser parses HTML, executes entry.client.tsx bundle
  └─ hydrateRoot() — React attaches to SSR HTML, no re-render
```

---

## `server.ts` — Cloudflare Worker Entry Point

**Full file:**

```ts
// server.ts
import * as serverBuild from 'virtual:react-router/server-build';
import {createRequestHandler, storefrontRedirect} from '@shopify/hydrogen';
import {createHydrogenRouterContext} from '~/lib/context';

export default {
  async fetch(
    request: Request,
    env: Env,
    executionContext: ExecutionContext,
  ): Promise<Response> {
    try {
      const hydrogenContext = await createHydrogenRouterContext(
        request,
        env,
        executionContext,
      );

      const handleRequest = createRequestHandler({
        build: serverBuild,
        mode: process.env.NODE_ENV,
        getLoadContext: () => hydrogenContext,
      });

      const response = await handleRequest(request);

      if (hydrogenContext.session.isPending) {
        response.headers.set(
          'Set-Cookie',
          await hydrogenContext.session.commit(),
        );
      }

      if (response.status === 404) {
        return storefrontRedirect({
          request,
          response,
          storefront: hydrogenContext.storefront,
        });
      }

      return response;
    } catch (error) {
      console.error(error);
      return new Response('An unexpected error occurred', {status: 500});
    }
  },
};
```

### Why `export default { async fetch() }` — not a server framework

Cloudflare Workers uses the **module format**: Cloudflare itself calls `.fetch()` on export. There is no Express, no Node.js `http` module, no OS process. The runtime is:

- **V8 isolate** — ~5ms cold start vs. ~300ms for Lambda
- **No file system** — `fs`, `path`, `__dirname` do not exist
- **No persistent memory** — each request gets a fresh isolate; global variables reset
- **Globally distributed** — Cloudflare runs your worker in 300+ datacenters; the request is handled by the one closest to the user

The three parameters Cloudflare injects:

| Parameter | Type | What it is |
|---|---|---|
| `request` | `Request` | Standard Web Fetch API Request — same as browser |
| `env` | `Env` | Secrets and bindings from `wrangler.toml` (never bundled into JS) |
| `executionContext` | `ExecutionContext` | Gives access to `waitUntil()` |

### `env` — secrets injected by Cloudflare, not process.env

In a Node.js app you'd read `process.env.SECRET`. In a Cloudflare Worker, `env` is passed as a parameter. You cannot accidentally leak it by bundling because it never touches the JS bundle — Cloudflare injects it at runtime only on the server side.

```ts
env.SESSION_SECRET            // signing key for cookies
env.PUBLIC_STORE_DOMAIN       // mystore.myshopify.com
env.PUBLIC_STOREFRONT_API_TOKEN
env.PRIVATE_STOREFRONT_API_TOKEN  // never sent to browser
```

### `executionContext.waitUntil(promise)`

Normally, Cloudflare kills the worker as soon as you return the `Response`. `waitUntil` tells Cloudflare: "keep this isolate alive until this promise settles, even though I already sent the response."

Hydrogen uses this for **background cache writes**: the user gets their response immediately, and the cache is populated after. Without `waitUntil`, the cache write would be cancelled mid-flight.

```ts
// inside @shopify/hydrogen internals — simplified
executionContext.waitUntil(
  cache.put(cacheKey, response.clone())
);
```

### `virtual:react-router/server-build`

This is a **Vite virtual module** — it doesn't exist on disk. At build time, Vite compiles all your route files plus React Router's framework code into a single server bundle, and exposes it under this virtual import. `serverBuild` contains the compiled route manifest, all loader/action functions, and the component tree.

### `createRequestHandler` (from `@shopify/hydrogen`)

```ts
const handleRequest = createRequestHandler({
  build: serverBuild,
  mode: process.env.NODE_ENV,
  getLoadContext: () => hydrogenContext,
});
```

This is a thin wrapper around React Router's own `createRequestHandler`. What it does:

1. Matches the incoming `request.url` against the route manifest in `serverBuild`
2. Calls the matched route's `loader()` (or `action()` for non-GET)
3. Passes the return value of `getLoadContext()` as `context` to every loader/action
4. Calls `entry.server.tsx` to render HTML
5. Returns the final `Response`

The `getLoadContext` function is what connects `context.ts` to your route files. Whatever `createHydrogenRouterContext` returns becomes `context` in:

```ts
export async function loader({ context }: Route.LoaderArgs) {
  const { storefront, session, cart, env } = context;
}
```

### Session commit — why it happens in `server.ts`, not in the route

```ts
if (hydrogenContext.session.isPending) {
  response.headers.set(
    'Set-Cookie',
    await hydrogenContext.session.commit(),
  );
}
```

Session mutations (`session.set`, `session.unset`) happen inside route loaders and actions. But the `Set-Cookie` header has to be on the final HTTP response. `server.ts` is the only place that has both the session object and the response object at the same time.

`isPending` is a flag that `AppSession.set()` and `.unset()` flip to `true`. If no mutation happened during the request, `isPending` stays `false` and no `Set-Cookie` is emitted — avoiding unnecessary cookie writes on every request.

### `storefrontRedirect` — the 404 redirect check

```ts
if (response.status === 404) {
  return storefrontRedirect({ request, response, storefront: hydrogenContext.storefront });
}
```

Shopify has a built-in redirect table (accessible via the Storefront API). When you change a product handle or collection slug, Shopify stores the old URL → new URL mapping. `storefrontRedirect` queries that table. If a redirect exists, it returns a `301`/`302` Response; if not, it passes the original `404` through.

---

## `app/lib/context.ts` — Building the Per-Request Context

**Full file:**

```ts
// app/lib/context.ts
import {createHydrogenContext} from '@shopify/hydrogen';
import {AppSession} from '~/lib/session';
import {CART_QUERY_FRAGMENT} from '~/lib/fragments';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {getLocaleFromRequest} from '~/lib/i18n';

const additionalContext = {
  // Add CMS clients, review SDKs, etc. here
  // cms: await createCMSClient(env),
} as const;

type AdditionalContextType = typeof additionalContext;

declare global {
  interface HydrogenAdditionalContext extends AdditionalContextType {}
  interface HydrogenCustomCartFragment extends CartApiQueryFragment {}
}

export async function createHydrogenRouterContext(
  request: Request,
  env: Env,
  executionContext: ExecutionContext,
) {
  if (!env?.SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }

  const waitUntil = executionContext.waitUntil.bind(executionContext);

  const [cache, session] = await Promise.all([
    caches.open('hydrogen'),
    AppSession.init(request, [env.SESSION_SECRET]),
  ]);

  const hydrogenContext = createHydrogenContext(
    {
      env,
      request,
      cache,
      waitUntil,
      session,
      i18n: getLocaleFromRequest(request),
      cart: {
        queryFragment: CART_QUERY_FRAGMENT,
      },
    },
    additionalContext,
  );

  return hydrogenContext;
}
```

### `Promise.all([cache, session])` — always parallel

Cache and session are independent. Running them in parallel saves ~10-30ms per request. If you add a third service (CMS, reviews):

```ts
const [cache, session, cms] = await Promise.all([
  caches.open('hydrogen'),
  AppSession.init(request, [env.SESSION_SECRET]),
  createCMSClient(env.CMS_TOKEN),  // runs at the same time
]);
```

### `caches.open('hydrogen')` — the Cloudflare Cache API

This is **not** an in-memory cache. It's the Cloudflare Cache API — a shared HTTP cache per datacenter. When Hydrogen stores a Storefront API response here, the next request in the same datacenter for the same query gets the cached result without hitting Shopify's servers.

This is what makes Hydrogen fast: the Storefront API call and the rendering both happen in the same datacenter as the user, and repeated queries are served from local cache.

### `createHydrogenContext` — what it builds

`createHydrogenContext` from `@shopify/hydrogen` builds several clients using the request, env, and cache you pass in:

| What's returned | How it's built |
|---|---|
| `storefront` | Storefront API GraphQL client, pre-configured with locale, auth headers, and the cache |
| `customerAccount` | Customer Account API client using the request origin |
| `cart` | Cart API handler, using your custom `queryFragment` |
| `session` | The `AppSession` you passed in |
| `env` | Passed through as-is |
| `waitUntil` | Passed through for background work |

### `HydrogenAdditionalContext` and `HydrogenCustomCartFragment` — TypeScript augmentation

```ts
declare global {
  interface HydrogenAdditionalContext extends AdditionalContextType {}
  interface HydrogenCustomCartFragment extends CartApiQueryFragment {}
}
```

These two `declare global` blocks teach TypeScript about:

1. **`HydrogenAdditionalContext`**: any extra properties you add (e.g. `cms`) become visible on `context` in loaders with full types — no casting needed
2. **`HydrogenCustomCartFragment`**: the codegen'd cart fragment type so `context.cart.get()` returns your extended cart type, not the minimal default

### Adding a third-party client (example)

```ts
// app/lib/context.ts
import {createCMSClient} from '~/lib/cms';

const additionalContext = {
  cms: null as Awaited<ReturnType<typeof createCMSClient>> | null,
} as const;

export async function createHydrogenRouterContext(request, env, executionContext) {
  const [cache, session, cms] = await Promise.all([
    caches.open('hydrogen'),
    AppSession.init(request, [env.SESSION_SECRET]),
    createCMSClient(env.CMS_TOKEN),
  ]);

  return createHydrogenContext(
    { env, request, cache, waitUntil, session, i18n: getLocaleFromRequest(request) },
    { cms },  // ← available as context.cms in every loader
  );
}
```

---

## `app/lib/session.ts` — Cookie Session on the Edge

**Full file:**

```ts
// app/lib/session.ts
import type {HydrogenSession} from '@shopify/hydrogen';
import {
  createCookieSessionStorage,
  type SessionStorage,
  type Session,
} from 'react-router';

export class AppSession implements HydrogenSession {
  public isPending = false;

  #sessionStorage;
  #session;

  constructor(sessionStorage: SessionStorage, session: Session) {
    this.#sessionStorage = sessionStorage;
    this.#session = session;
  }

  static async init(request: Request, secrets: string[]) {
    const storage = createCookieSessionStorage({
      cookie: {
        name: 'session',
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secrets,
      },
    });

    const session = await storage
      .getSession(request.headers.get('Cookie'))
      .catch(() => storage.getSession());

    return new this(storage, session);
  }

  get has() { return this.#session.has; }
  get get() { return this.#session.get; }
  get flash() { return this.#session.flash; }

  get unset() {
    this.isPending = true;
    return this.#session.unset;
  }

  get set() {
    this.isPending = true;
    return this.#session.set;
  }

  destroy() {
    return this.#sessionStorage.destroySession(this.#session);
  }

  commit() {
    this.isPending = false;
    return this.#sessionStorage.commitSession(this.#session);
  }
}
```

### How cookie-based sessions work (no database)

Unlike Express sessions which store data server-side and put only a session ID in the cookie, this implementation **stores all session data inside the cookie itself**. The cookie is:

- **Signed** using HMAC with `SESSION_SECRET` — tampering is detectable
- **Not encrypted** — don't store passwords or credit cards here
- **HTTP-only** — JS in the browser cannot read it (`document.cookie` returns nothing for this cookie)
- **SameSite: lax** — sent on top-level navigations but not cross-site AJAX

The data structure inside the cookie (base64-encoded JSON):

```json
{
  "customerAccessToken": "...",
  "cartId": "gid://shopify/Cart/abc123"
}
```

### How `isPending` controls the Set-Cookie lifecycle

```
Request arrives
  │
  AppSession.init() reads the cookie → isPending = false
  │
  loader() / action() runs
  │
  session.set('customerAccessToken', token)  → isPending = true
  │
  handleRequest() returns Response
  │
  server.ts checks: if (session.isPending)
    └─ session.commit() → serializes + signs data → returns Set-Cookie string
    └─ response.headers.set('Set-Cookie', ...)
  │
  Response sent to browser with Set-Cookie header
  │
  Browser stores the new cookie
```

If no `set`/`unset` is called during the request, `isPending` stays `false` and no `Set-Cookie` header is added — the cookie is unchanged.

### Reading the session in a loader

```ts
// routes/auth/login.tsx
export async function action({ request, context }: Route.ActionArgs) {
  const { session, customerAccount } = context;

  const formData = await request.formData();
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  // authenticate via Customer Account API
  const { accessToken } = await customerAccount.login({ email, password });

  // write to session — sets isPending = true
  session.set('customerAccessToken', accessToken);

  // redirect — server.ts will commit the session before sending this response
  return redirect('/account');
}
```

### Reading from the session

```ts
export async function loader({ context }: Route.LoaderArgs) {
  const { session } = context;

  const token = session.get('customerAccessToken');

  if (!token) {
    throw redirect('/account/login');
  }

  return { token };
}
```

### Destroying the session (logout)

```ts
// routes/auth/logout.tsx
export async function action({ context }: Route.ActionArgs) {
  const { session } = context;

  // destroySession signs a blank cookie with max-age=0
  // the browser deletes its stored cookie on receipt
  return redirect('/', {
    headers: { 'Set-Cookie': await session.destroy() },
  });
}
```

Note: for logout the `Set-Cookie` is set directly on the redirect response — `session.destroy()` bypasses `isPending` and returns the header value directly.

### Flash messages — one-read session values

```ts
// In an action — set flash
session.flash('successMessage', 'Profile updated!');
return redirect('/account/profile');

// In the next loader — read and auto-delete
const message = session.get('successMessage');
// message is 'Profile updated!' on first read, undefined on subsequent reads
```

`flash()` stores data that is automatically removed from the session after the next `session.get()` call. Useful for one-time success/error messages after form submissions.

---

## `app/entry.server.tsx` — SSR Rendering

Called by React Router's handler after all loaders have resolved. At this point, data is ready; this file turns it into HTML.

**Full file:**

```tsx
// app/entry.server.tsx
import {ServerRouter} from 'react-router';
import {isbot} from 'isbot';
import {renderToReadableStream} from 'react-dom/server';
import {
  createContentSecurityPolicy,
  type HydrogenRouterContextProvider,
} from '@shopify/hydrogen';
import type {EntryContext} from 'react-router';

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
  context: HydrogenRouterContextProvider,
) {
  const {nonce, header, NonceProvider} = createContentSecurityPolicy({
    shop: {
      checkoutDomain: context.env.PUBLIC_CHECKOUT_DOMAIN,
      storeDomain: context.env.PUBLIC_STORE_DOMAIN,
    },
  });

  const body = await renderToReadableStream(
    <NonceProvider>
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
        nonce={nonce}
      />
    </NonceProvider>,
    {
      nonce,
      signal: request.signal,
      onError(error) {
        console.error(error);
        responseStatusCode = 500;
      },
    },
  );

  if (isbot(request.headers.get('user-agent'))) {
    await body.allReady;
  }

  responseHeaders.set('Content-Type', 'text/html');
  responseHeaders.set('Content-Security-Policy', header);

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
```

### `renderToReadableStream` — React 18 streaming SSR

React 18 introduced streaming SSR. Instead of waiting for the entire page to render before sending anything, `renderToReadableStream` returns a `ReadableStream` and starts pushing HTML chunks immediately.

```
Time 0ms:   Browser receives <html><head>...</head><body><nav>...</nav>
Time 0ms:   Browser receives <h1>Product Title</h1><p>Price: $29</p>
            (critical data is already available — loader awaited it)
Time 50ms:  Deferred Promise resolves on server
Time 50ms:  Browser receives <div>Recommended Products...</div>
            React swaps the Suspense fallback for real content
```

Without streaming, the browser would wait until all deferred data resolved before receiving even the `<html>` tag.

### `signal: request.signal` — abort on disconnect

```ts
const body = await renderToReadableStream(
  <ServerRouter ... />,
  { signal: request.signal }   // ← this
);
```

If the user navigates away mid-render, the browser closes the connection. The `request.signal` fires `abort`, React stops rendering, and the worker releases resources. Without this, the worker would finish rendering a page nobody is going to see.

### `nonce` — Content Security Policy

```ts
const {nonce, header, NonceProvider} = createContentSecurityPolicy({
  shop: {
    checkoutDomain: context.env.PUBLIC_CHECKOUT_DOMAIN,
    storeDomain: context.env.PUBLIC_STORE_DOMAIN,
  },
});
```

A **nonce** is a random string generated fresh on every request. It's embedded in:

1. Every `<script nonce="abc123">` tag React renders
2. The `Content-Security-Policy` header: `script-src 'nonce-abc123'`

The browser will only execute scripts that have the matching nonce. This blocks XSS attacks — even if an attacker injects `<script>alert(1)</script>`, the browser rejects it because it has no nonce.

`NonceProvider` makes the nonce available via React context so React Router can stamp it on every script tag it generates.

### `isbot` — wait for full render before sending to crawlers

```ts
if (isbot(request.headers.get('user-agent'))) {
  await body.allReady;
}
```

Googlebot, Bingbot, and other crawlers don't execute JavaScript. If they receive a streaming response and the content they need to index is in a deferred chunk, they might index an incomplete page. `body.allReady` is a Promise that resolves when the entire React tree has rendered — we await it for bots so they always receive the fully-rendered HTML before we start sending.

---

## `app/entry.client.tsx` — Browser Hydration

**Full file:**

```tsx
// app/entry.client.tsx
import {HydratedRouter} from 'react-router/dom';
import {startTransition, StrictMode} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {NonceProvider} from '@shopify/hydrogen';

if (!window.location.origin.includes('webcache.googleusercontent.com')) {
  startTransition(() => {
    const existingNonce =
      document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;

    hydrateRoot(
      document,
      <StrictMode>
        <NonceProvider value={existingNonce}>
          <HydratedRouter />
        </NonceProvider>
      </StrictMode>,
    );
  });
}
```

### `hydrateRoot` — attach, don't re-render

`hydrateRoot` is fundamentally different from `createRoot` (which you'd use for a pure SPA with no SSR).

- `createRoot` renders the React tree from scratch into an empty `<div>`
- `hydrateRoot` **walks the existing server-rendered DOM** and attaches React's fiber tree to it — no DOM nodes are created or destroyed

The HTML the browser already received from the server is preserved exactly. React only adds event listeners and sets up the internal state needed for future re-renders. This is why SSR pages appear instantly — the HTML is already there before any JS runs.

### `startTransition` — don't block the browser

```ts
startTransition(() => {
  hydrateRoot(document, <StrictMode>...</StrictMode>);
});
```

Hydration (walking the entire DOM tree to attach React) is CPU-intensive for large pages. Wrapping it in `startTransition` marks it as a **non-urgent** update — the browser can interrupt it to handle user input (scroll, click) and resume hydration between frames. Without this, a large page could freeze the browser's main thread for hundreds of milliseconds during hydration.

### Reading the nonce from the DOM

```ts
const existingNonce =
  document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;
```

The server embedded the nonce in every `<script nonce="abc123">` tag. The client reads it back from the DOM. This is necessary so that any scripts React generates on the client (during subsequent navigations) also carry the nonce and pass CSP validation.

### The Google cache guard

```ts
if (!window.location.origin.includes('webcache.googleusercontent.com')) {
```

Google's cached page viewer (`webcache.googleusercontent.com`) serves a frozen snapshot of a page. Running `hydrateRoot` in that context breaks the page because the app tries to set up router listeners, make API calls, etc. on a static snapshot. The guard skips hydration entirely when the app is being viewed through Google's cache.

### What happens after hydration

After `hydrateRoot` completes:

- All navigation (`<Link>` clicks, `navigate()`) is handled **client-side by React Router** — no full page reload
- `loader` functions for new routes are called via **fetch requests** to the Cloudflare worker (not full page loads)
- The worker returns JSON (not HTML) for client-side navigations — React Router merges the new loader data into the existing React tree
- The URL updates via the History API

---

## Putting It All Together — Annotated Timeline

```
t=0ms   Browser: GET /products/cool-shirt

t=2ms   Cloudflare: routes to nearest edge datacenter
        server.ts: fetch() called

t=3ms   context.ts: Promise.all([caches.open(), AppSession.init()])
        - caches.open: opens 'hydrogen' cache namespace
        - AppSession.init: reads Cookie header, decodes + verifies HMAC signature,
          deserialises JSON → { cartId: 'gid://...' }

t=5ms   server.ts: createRequestHandler() called
        - matches '/products/cool-shirt' → routes/catalog/products/$handle.tsx
        - calls loader({ params: { handle: 'cool-shirt' }, context: hydrogenContext })

t=6ms   loader: context.storefront.query(PRODUCT_QUERY, { cache: CacheLong() })
        - checks Cloudflare Cache API for this query
        - CACHE HIT: returns cached response in ~1ms
        - CACHE MISS: fetches from Shopify Storefront API (~80ms), stores in cache

t=7ms   loader returns { product: { title: 'Cool Shirt', price: ... } }

t=8ms   entry.server.tsx: renderToReadableStream() starts
        - nonce generated: 'xK9pL2'
        - React renders <Layout><ProductPage product={...} /></Layout>
        - first HTML chunk ready immediately

t=9ms   server.ts: handleRequest() returns Response (ReadableStream body)
        - session.isPending = false (no mutations) → no Set-Cookie
        - status = 200 → no storefrontRedirect check

t=9ms   Cloudflare: starts streaming response to browser

t=9ms   Browser: receives first HTML chunk
        <html><head>
          <script nonce="xK9pL2" src="/assets/entry.client.js"></script>
        </head><body>
          <nav>...</nav>
          <h1>Cool Shirt</h1>
          <p>$29.00</p>

t=12ms  Browser: FCP (First Contentful Paint) — user sees the page

t=150ms entry.client.tsx bundle loads and executes
        hydrateRoot() called — React attaches to existing DOM
        NonceProvider picks up nonce 'xK9pL2' from existing <script> tag

t=155ms Hydration complete — React Router active
        All <Link> clicks now navigate client-side without full page reloads
```

---

## Session Attachment — End-to-End Example (Login Flow)

Here's the full session lifecycle for a login → authenticated page → logout sequence:

### Step 1 — Login action writes the session

```ts
// routes/auth/login.tsx
export async function action({ request, context }: Route.ActionArgs) {
  const { session, customerAccount } = context;
  const formData = await request.formData();

  const { accessToken, expiresAt } = await customerAccount.login({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  });

  session.set('customerAccessToken', accessToken);  // isPending = true
  session.set('tokenExpiresAt', expiresAt);         // isPending already true

  return redirect('/account');
}
```

```
server.ts receives the redirect Response from the action
  │
  hydrogenContext.session.isPending = true  ← set() was called twice
  │
  session.commit() called:
    - serialises: { customerAccessToken: 'xxx', tokenExpiresAt: '...' }
    - HMAC signs with SESSION_SECRET
    - base64 encodes
    - returns: 'session=eyJjdXN0b21...; Path=/; HttpOnly; SameSite=Lax'
  │
  response.headers.set('Set-Cookie', '...')
  │
  302 redirect with Set-Cookie sent to browser
  │
  Browser stores cookie, follows redirect to /account
```

### Step 2 — Authenticated loader reads the session

```ts
// routes/account/layout.tsx
export async function loader({ context }: Route.LoaderArgs) {
  const { session, customerAccount } = context;

  // AppSession.init() already ran and decoded the cookie
  const token = session.get('customerAccessToken');  // 'xxx...' — no isPending change

  if (!token) throw redirect('/account/login');

  const customer = await customerAccount.get();
  return { customer };
}
```

```
Browser: GET /account  (Cookie: session=eyJjdXN0b21...)
  │
  AppSession.init():
    - reads Cookie header: 'session=eyJjdXN0b21...'
    - verifies HMAC signature
    - decodes: { customerAccessToken: 'xxx', tokenExpiresAt: '...' }
    - isPending = false
  │
  loader: session.get('customerAccessToken') → 'xxx'
  │
  No session.set() called → isPending stays false
  │
  server.ts: session.isPending = false → no Set-Cookie header on this response
```

### Step 3 — Logout destroys the session

```ts
// routes/auth/logout.tsx
export async function action({ context }: Route.ActionArgs) {
  const { session } = context;

  // destroy() returns the Set-Cookie value with max-age=0
  const cookie = await session.destroy();

  return redirect('/', {
    headers: { 'Set-Cookie': cookie },
  });
}
```

```
session.destroy() internally calls:
  sessionStorage.destroySession(session)
  → 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'

302 redirect with Set-Cookie: session=; Max-Age=0
  │
  Browser receives Max-Age=0 → deletes the cookie
  │
  User is now logged out — next request has no Cookie header
```

Note: logout bypasses `isPending` because `destroy()` returns the `Set-Cookie` string directly. The route action sets it manually on the redirect Response, not via `server.ts`.

---

## Summary Reference

| File | Runs on | Called by | Purpose |
|---|---|---|---|
| `server.ts` | Edge worker | Cloudflare | Entry point; wires context → handler → session commit |
| `app/lib/context.ts` | Edge worker | `server.ts` | Builds storefront, cart, session clients per request |
| `app/lib/session.ts` | Edge worker | `context.ts` | Cookie-based session: read in init, write tracked by isPending |
| `app/entry.server.tsx` | Edge worker | React Router handler | Renders HTML stream with CSP nonce; waits for bots |
| `app/entry.client.tsx` | Browser | Browser JS engine | Hydrates SSR HTML; sets up client-side navigation |
