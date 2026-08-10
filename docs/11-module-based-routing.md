# 11 — Module-Based Routing

## What We Implemented

All route files live inside `app/routes/` organized into domain folders. Three flat files (locale layout, catch-all, robots) coexist with the domain folders. Every route is registered explicitly in `routes.ts` — no file-system auto-discovery.

### Final File Structure

```
app/routes/
│
│  ── flat files (infrastructure) ──────────────────────────────────
├── ($locale).tsx               ← locale layout — wraps all locale routes
├── ($locale).$.tsx             ← 404 catch-all
├── [robots.txt].tsx            ← robots.txt handler
│
│  ── domain folders (your actual routes) ──────────────────────────
├── home/
│   └── index.tsx               ← /
│
├── catalog/
│   ├── products/
│   │   └── $handle.tsx         ← /products/:handle
│   ├── collections/
│   │   ├── index.tsx           ← /collections
│   │   ├── all.tsx             ← /collections/all
│   │   └── $handle.tsx         ← /collections/:handle
│   └── search.tsx              ← /search
│
├── cart/
│   ├── index.tsx               ← /cart
│   └── $lines.tsx              ← /cart/:lines (permalink)
│
├── account/
│   ├── layout.tsx              ← account layout (Outlet + auth guard)
│   ├── index.tsx               ← /account (redirects to /account/orders)
│   ├── profile.tsx             ← /account/profile
│   ├── addresses.tsx           ← /account/addresses
│   ├── $.tsx                   ← /account/* catch-all
│   └── orders/
│       ├── index.tsx           ← /account/orders
│       └── $id.tsx             ← /account/orders/:id
│
├── auth/
│   ├── login.tsx               ← /account/login
│   ├── logout.tsx              ← /account/logout
│   └── authorize.tsx           ← /account/authorize (OAuth callback)
│
├── content/
│   ├── blogs/
│   │   ├── index.tsx           ← /blogs
│   │   └── $blogHandle/
│   │       ├── index.tsx       ← /blogs/:blogHandle
│   │       └── $articleHandle.tsx  ← /blogs/:blogHandle/:articleHandle
│   ├── pages/
│   │   └── $handle.tsx         ← /pages/:handle
│   └── policies/
│       ├── index.tsx           ← /policies
│       └── $handle.tsx         ← /policies/:handle
│
└── system/
    ├── discount.tsx            ← /discount/:code
    ├── sitemap-index.tsx       ← /sitemap.xml
    └── sitemap.tsx             ← /sitemap/:type/:page.xml
```

---

## `app/routes.ts` — The Route Registry

Every route is registered here explicitly. React Router does **not** auto-discover files — you control the full URL tree.

```ts
// app/routes.ts
import {type RouteConfig, route, layout, index} from '@react-router/dev/routes';
import {hydrogenRoutes} from '@shopify/hydrogen';

export default hydrogenRoutes([

  // Optional /:locale? prefix wraps all locale-aware routes
  route(':locale?', 'routes/($locale).tsx', [

    // HOME
    index('routes/home/index.tsx'),

    // CATALOG
    route('products/:handle',    'routes/catalog/products/$handle.tsx'),
    route('collections',         'routes/catalog/collections/index.tsx'),
    route('collections/all',     'routes/catalog/collections/all.tsx'),
    route('collections/:handle', 'routes/catalog/collections/$handle.tsx'),
    route('search',              'routes/catalog/search.tsx'),

    // CART
    route('cart',           'routes/cart/index.tsx'),
    route('cart/:lines',    'routes/cart/$lines.tsx'),
    route('discount/:code', 'routes/system/discount.tsx'),

    // ACCOUNT — authenticated routes share the account layout
    layout('routes/account/layout.tsx', [
      route('account',            'routes/account/index.tsx'),
      route('account/profile',    'routes/account/profile.tsx'),
      route('account/addresses',  'routes/account/addresses.tsx'),
      route('account/orders',     'routes/account/orders/index.tsx'),
      route('account/orders/:id', 'routes/account/orders/$id.tsx'),
      route('account/*',          'routes/account/$.tsx'),
    ]),

    // AUTH — outside account layout (no auth guard, handles login/logout)
    route('account/login',     'routes/auth/login.tsx'),
    route('account/logout',    'routes/auth/logout.tsx'),
    route('account/authorize', 'routes/auth/authorize.tsx'),

    // CONTENT
    route('blogs',                            'routes/content/blogs/index.tsx'),
    route('blogs/:blogHandle',                'routes/content/blogs/$blogHandle/index.tsx'),
    route('blogs/:blogHandle/:articleHandle', 'routes/content/blogs/$blogHandle/$articleHandle.tsx'),
    route('pages/:handle',                    'routes/content/pages/$handle.tsx'),
    route('policies',                         'routes/content/policies/index.tsx'),
    route('policies/:handle',                 'routes/content/policies/$handle.tsx'),

    // SYSTEM
    route('sitemap.xml',             'routes/system/sitemap-index.tsx'),
    route('sitemap/:type/:page.xml', 'routes/system/sitemap.tsx'),

    // CATCH-ALL 404
    route('*', 'routes/($locale).$.tsx'),
  ]),

  // Outside locale wrapper
  route('robots.txt', 'routes/[robots.txt].tsx'),

]) satisfies RouteConfig;
```

### Why `hydrogenRoutes()` wraps the array

`hydrogenRoutes` from `@shopify/hydrogen` appends Hydrogen's internal virtual routes (GraphiQL, subrequest profiler, dev tools) to your route config in development. In production those routes are stripped. You don't configure them — they're injected automatically.

### Why `route(':locale?', ...)` instead of `layout()`

The locale wrapper uses `route` (not `layout`) because it has a URL segment — the optional `:locale?` param. This means:

- `/` → `locale` is `undefined` → English
- `/en-us/` → `locale` is `'en-us'` → US English
- `/fr-fr/products/cool-shirt` → `locale` is `'fr-fr'` → French France

The `($locale).tsx` file reads this param, validates it, and sets the i18n context for all child loaders.

### `layout()` vs `route()` for the account section

```ts
// layout() — no URL segment, just wraps children with a shared UI
layout('routes/account/layout.tsx', [
  route('account',         'routes/account/index.tsx'),    // /account
  route('account/profile', 'routes/account/profile.tsx'),  // /account/profile
])

// route() — adds a URL segment
route('account/login', 'routes/auth/login.tsx')  // /account/login
```

`layout()` renders its file as a wrapping component (with `<Outlet />`) around all children, but contributes no URL segment. The account layout uses this to:
1. Check if the user is authenticated — redirect to login if not
2. Render the account sidebar/nav that persists across all `/account/*` pages

`auth/login.tsx`, `auth/logout.tsx`, and `auth/authorize.tsx` are outside the `layout()` block intentionally — they must be reachable without authentication.

---

## How Type Generation Works

React Router generates TypeScript types for each route file. When you run:

```bash
npx react-router typegen
```

It creates files in `.react-router/types/` mirroring your `app/` structure:

```
.react-router/types/app/routes/
  catalog/products/+types/$handle.ts   ← generated for $handle.tsx
  account/orders/+types/$id.ts         ← generated for $id.tsx
  home/+types/index.ts                 ← generated for index.tsx
  ...
```

Each route file imports its types with a relative path matching its own filename:

```ts
// routes/catalog/products/$handle.tsx
import type {Route} from './+types/$handle';   // ← matches filename

// routes/account/orders/$id.tsx
import type {Route} from './+types/$id';        // ← matches filename

// routes/home/index.tsx
import type {Route} from './+types/index';      // ← matches filename

// routes/($locale).$.tsx  (flat file in routes/)
import type {Route} from './+types/($locale).$'; // ← matches full filename
```

The `tsconfig.json` `rootDirs` setting makes these imports resolve correctly across the two trees:

```json
{
  "compilerOptions": {
    "rootDirs": [".", "./.react-router/types"]
  }
}
```

---

## Inside a Route File

Every route file — regardless of which domain folder it lives in — has the same structure:

```tsx
// routes/catalog/products/$handle.tsx
import type {Route} from './+types/$handle';

// Runs on the server only — safe to use secrets, session, etc.
export async function loader({params, context}: Route.LoaderArgs) {
  const {handle} = params;
  const {storefront} = context;

  const {product} = await storefront.query(PRODUCT_QUERY, {
    variables: {handle},
    cache: storefront.CacheLong(),
  });

  if (!product) throw new Response('Not found', {status: 404});

  return {product};
}

// Runs on server + client — used for <head> tags
export const meta: Route.MetaFunction = ({data}) => [
  {title: `${data?.product.title} | My Store`},
];

// The React component — receives loader data via useLoaderData
export default function ProductPage() {
  const {product} = useLoaderData<typeof loader>();
  return <div>{product.title}</div>;
}

const PRODUCT_QUERY = `#graphql
  query Product($handle: String!) {
    product(handle: $handle) {
      id
      title
      handle
    }
  }
` as const;
```

---

## Account Routes — Why `layout()` + `auth/` Separation Matters

```
layout('routes/account/layout.tsx', [...])   ← runs loader + renders for all /account/* pages
  route('account',         ...)              ← /account
  route('account/profile', ...)              ← /account/profile
  route('account/orders',  ...)              ← /account/orders

route('account/login',     ...)  ← /account/login   ← NOT inside layout()
route('account/authorize', ...)  ← /account/authorize  ← NOT inside layout()
```

The `account/layout.tsx` loader checks for a valid session token. If the token is missing, it redirects to `/account/login`. Routes inside `layout()` inherit this protection automatically — every authenticated page is covered by a single auth check.

Login and authorize are outside `layout()` because:
- Login must be reachable without a session (that's the point)
- Authorize is the OAuth callback — Shopify calls it during the OAuth flow, before a session exists

```ts
// routes/account/layout.tsx
export async function loader({context}: Route.LoaderArgs) {
  const {customerAccount} = context;

  // throws redirect('/account/login') if not authenticated
  await customerAccount.handleAuthStatus();

  const customer = await customerAccount.get();
  return {customer};
}

export default function AccountLayout() {
  const {customer} = useLoaderData<typeof loader>();
  return (
    <div>
      <AccountNav customer={customer} />
      <Outlet />   {/* child routes render here */}
    </div>
  );
}
```

---

## Account Routes in Local Development — The OAuth Tunnel Requirement

Hitting `/account/orders` (or any `/account/*` route) locally at `http://localhost:3000` produces:

```
400 — Customer Account API OAuth requires a Hydrogen tunnel in local development.
Run the development server with the `--customer-account-push` flag,
then open the tunnel URL shown in your terminal (https://*.tryhydrogen.dev)
instead of localhost.
```

**Why this happens:** The Shopify Customer Account API uses OAuth 2.0. OAuth requires Shopify to redirect back to a registered callback URL after authentication. Shopify only accepts `https://*.tryhydrogen.dev` as a valid redirect URI in development — `http://localhost:3000` is rejected because:

1. It's not HTTPS
2. It's not a registered OAuth redirect URI in your Shopify app config

**The fix — always start dev with the tunnel flag:**

```bash
shopify hydrogen dev --customer-account-push
```

Your terminal shows two URLs:

```
Local:    http://localhost:3000
Network:  https://abc123.tryhydrogen.dev   ← use this for account routes
```

Use the `https://*.tryhydrogen.dev` URL for all testing that touches authentication. Non-account routes (`/`, `/products/*`, `/collections/*`) work on `localhost` fine.

---

## Adding a New Route

To add a new route — for example, `/wishlist`:

**1. Create the file:**

```tsx
// app/routes/account/wishlist.tsx
import type {Route} from './+types/wishlist';

export async function loader({context}: Route.LoaderArgs) {
  const {customerAccount} = context;
  await customerAccount.handleAuthStatus();
  // fetch wishlist...
  return {items: []};
}

export default function WishlistPage() {
  const {items} = useLoaderData<typeof loader>();
  return <div>Wishlist</div>;
}
```

**2. Register it in `routes.ts`:**

```ts
// inside layout('routes/account/layout.tsx', [...])
route('account/wishlist', 'routes/account/wishlist.tsx'),
```

**3. Run typegen:**

```bash
npx react-router typegen
```

That's it — no other files change.

---

## Why Not `flatRoutes` (Auto-Discovery)?

The original Hydrogen scaffold uses `flatRoutes()` which discovers routes automatically by filename convention. We switched to manual `routes.ts` because:

| Problem with `flatRoutes` | Result |
|---|---|
| Every file needs `($locale).` prefix | `($locale).products.$handle.tsx` — hard to read |
| Only discovers one level deep | `_group/routeName/route.tsx` (two levels) is silently ignored |
| No control over nesting | `layout()` relationships must be expressed in filenames |
| Auto-discovery is magic | Broken routes fail silently at runtime, not build time |

With manual `routes.ts`:
- Filenames are clean: `products/$handle.tsx` not `($locale).products.$handle.tsx`
- The route tree is explicit and readable in one file
- Wrong paths fail at build time with a clear error
- `layout()` nesting is expressed in code, not filename conventions
