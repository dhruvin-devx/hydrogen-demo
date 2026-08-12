# Hydrogen New Project — Best Practices & Setup Guide

Everything learned while building this demo, in one place. When you start a new Hydrogen project, use this document as your checklist and reference.

---

## 1. Tech Stack (locked versions that work)

```
@shopify/hydrogen        2026.4.4
react-router             7.16.0
@react-router/dev        7.16.0
react / react-dom        ^18.3.1
tailwindcss              ^4.1.6   (v4 — CSS-first config)
remix-utils              ^9.3.1   (CSRF helpers)
@oslojs/crypto           ^1.0.1   (remix-utils peer dep)
@oslojs/encoding         ^1.1.0   (remix-utils peer dep)
typescript               ^5.9.2
vite                     ^8.0.1
```

Install `remix-utils` with `--legacy-peer-deps` if you hit React 18/19 peer dep conflicts:
```bash
npm install remix-utils @oslojs/crypto @oslojs/encoding --legacy-peer-deps
```

---

## 2. Folder Structure (the pattern that scales)

```
app/
├── assets/                  # Static assets (favicon, images)
├── components/              # Reusable UI components — no route logic here
│   ├── Aside.tsx            # Slide-in panel (cart, search, mobile menu)
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── PageLayout.tsx       # Root shell: Header + Aside.Provider + Footer
│   ├── CartMain.tsx
│   ├── CartLineItem.tsx
│   ├── CartSummary.tsx
│   ├── ProductForm.tsx
│   ├── ProductImage.tsx
│   ├── ProductItem.tsx
│   ├── ProductPrice.tsx
│   ├── PaginatedResourceSection.tsx
│   └── Search*.tsx
├── lib/                     # Pure utilities — no JSX, no route exports
│   ├── session.ts           # AppSession (cookie-based, httpOnly)
│   ├── csrf.server.ts       # CSRF instance (server-only, .server suffix)
│   ├── fragments.ts         # Shared GraphQL fragments
│   ├── i18n.ts              # Locale helpers
│   ├── variants.ts          # Product variant helpers
│   └── search.ts
├── routes/                  # One folder per domain; files are flat leaf routes
│   ├── home/index.tsx
│   ├── catalog/
│   │   ├── products/$handle.tsx
│   │   ├── collections/index.tsx
│   │   └── collections/$handle.tsx
│   ├── cart/index.tsx
│   ├── account/
│   │   ├── layout.tsx       # Auth-guard layout route
│   │   ├── index.tsx
│   │   └── orders/
│   ├── auth/                # login / logout / authorize
│   ├── content/             # blogs / pages / policies
│   ├── api/                 # Resource routes (GET-only proxies, etc.)
│   ├── system/              # sitemap, robots, internal demos
│   └── reviews-demo/        # Feature demo — isolate demos in their own folder
├── styles/
│   ├── app.css              # CSS variables + component-scoped CSS
│   ├── reset.css            # Box-model reset
│   └── tailwind.css         # @import 'tailwindcss'; (Tailwind v4 entry point)
├── root.tsx                 # Root layout, root loader, AuthenticityTokenProvider
└── routes.ts                # Manual route config (see Section 4)

docs/                        # Project documentation
review-server/               # Example: standalone third-party mock server
env.d.ts                     # Global Env interface (extends Cloudflare Worker types)
```

**Rules:**
- `lib/` files are pure TypeScript. Never import React or route types here.
- Files that must NOT ship to the browser get a `.server.ts` suffix (e.g. `csrf.server.ts`).
- Components that use browser-only APIs get a `.client.tsx` suffix.

---

## 3. Environment Variables

### Critical rule: `process.env` does NOT work in Hydrogen

Hydrogen runs on Cloudflare Workers. `process.env` is a Node.js concept — it returns `undefined` in Workers and causes silent failures (empty API keys, wrong URLs, etc.).

**Always use `context.env`:**
```ts
// WRONG — silently returns undefined in Workers
const key = process.env.REVIEW_API_KEY;

// CORRECT
const {REVIEW_API_KEY} = context.env as Env;
```

**Exception:** Vite build-time constants like `process.env.NODE_ENV` ARE set at build time by Vite's `define` — safe to use in code that runs at module init (e.g. the `secure` flag on cookies).

### Declare all env vars in `env.d.ts`

```ts
declare global {
  interface Env {
    // Third-party service credentials
    REVIEW_API_URL: string;
    REVIEW_API_KEY: string;
    // Add every key your app reads from context.env
  }
}
```

Then `context.env as Env` gives you full TypeScript autocomplete.

### `.env` file for local dev

```bash
SESSION_SECRET=<random-hex-string>
PUBLIC_STORE_DOMAIN=your-store.myshopify.com
PUBLIC_STOREFRONT_API_TOKEN=...
PRIVATE_STOREFRONT_API_TOKEN=...
# Third-party keys
REVIEW_API_URL=http://localhost:3001
REVIEW_API_KEY=your-dev-key
```

---

## 4. Routing (`routes.ts` — manual config)

Hydrogen uses a manual `routes.ts` instead of file-based conventions. This gives you explicit control over locale prefixes and route grouping.

```ts
// app/routes.ts
import {type RouteConfig, route, layout, index} from '@react-router/dev/routes';
import {hydrogenRoutes} from '@shopify/hydrogen';

export default hydrogenRoutes([
  // ── Routes outside the locale wrapper ────────────────────────────
  route('api/reviews', 'routes/api/reviews.ts'),   // resource route — no locale prefix
  route('robots.txt',  'routes/[robots.txt].tsx'),

  // ── Locale layout — optional /:locale? wraps everything ──────────
  route(':locale?', 'routes/($locale).tsx', [
    index('routes/home/index.tsx'),

    // Group by domain
    route('products/:handle',    'routes/catalog/products/$handle.tsx'),
    route('collections/:handle', 'routes/catalog/collections/$handle.tsx'),

    // Auth-guard layout — wraps only the routes that need auth
    layout('routes/account/layout.tsx', [
      route('account',           'routes/account/index.tsx'),
      route('account/profile',   'routes/account/profile.tsx'),
    ]),

    // Auth flows — outside the layout guard
    route('account/login',  'routes/auth/login.tsx'),
    route('account/logout', 'routes/auth/logout.tsx'),

    // Catch-all 404
    route('*', 'routes/($locale).$.tsx'),
  ]),
]) satisfies RouteConfig;
```

**Patterns:**
- Resource routes (API endpoints) go **outside** the locale wrapper.
- Use `layout()` for routes that share an auth guard or a nested UI frame.
- Keep auth flows (`/login`, `/logout`, `/authorize`) outside the auth-guarded layout.

---

## 5. Loader & Action Patterns

### `loader()` — read data for the page

```ts
import type {LoaderFunctionArgs} from 'react-router';

export async function loader({request, context}: LoaderFunctionArgs) {
  const {storefront, env} = context;

  // Critical data — awaited (blocks HTML)
  const criticalData = await loadCriticalData(context);

  // Deferred data — not awaited (streams in via Suspense)
  const deferredData = loadDeferredData(context);

  return {...criticalData, ...deferredData};
}
```

### `action()` — handle form mutations

```ts
import type {ActionFunctionArgs} from 'react-router';

export async function action({request, context}: ActionFunctionArgs) {
  // 1. Validate CSRF
  await csrf.validate(request);   // throws CSRFError on mismatch

  // 2. Optionally gate on auth
  // const isLoggedIn = await context.customerAccount.isLoggedIn();

  // 3. Read form data
  const fd = await request.formData();
  const value = fd.get('fieldName') as string;

  // 4. Call upstream with server-side credentials
  const {MY_API_KEY} = context.env as Env;
  const res = await fetch('https://api.example.com/endpoint', {
    method: 'POST',
    headers: {'x-api-key': MY_API_KEY, 'Content-Type': 'application/json'},
    body: JSON.stringify({value}),
  });
  return res.json();
}
```

### Deferred (streaming) data

```ts
import {Await} from 'react-router';
import {Suspense} from 'react';

// In loader — return a Promise (not awaited)
function loadDeferredData({context}: LoaderFunctionArgs) {
  return {
    reviews: fetchReviews(context).catch(() => null), // never throw inside deferred
  };
}

// In component — wrap with Suspense + Await
<Suspense fallback={<p>Loading…</p>}>
  <Await resolve={reviews}>
    {(data) => <ReviewList data={data} />}
  </Await>
</Suspense>
```

---

## 6. `useFetcher` Patterns

### Pattern A — lazy load (GET resource route)

```ts
const fetcher = useFetcher<{items: Item[]}>();

useEffect(() => {
  fetcher.load('/api/reviews?productId=x');
}, [productId]);
```

### Pattern B — POST to the page's own `action()` (no proxy route needed)

```tsx
const submitFetcher = useFetcher<ActionData>();

<submitFetcher.Form method="post" action="/reviews-demo">
  <AuthenticityTokenInput />
  <input type="hidden" name="productId" value={productId} />
  {/* other fields */}
  <button type="submit">Submit</button>
</submitFetcher.Form>
```

`action="/reviews-demo"` calls **this file's** `action()` on the server. The API key stays on the server. No separate proxy route needed for writes.

---

## 7. Session (`AppSession`)

```ts
// app/lib/session.ts
import {createCookieSessionStorage} from 'react-router';
import type {HydrogenSession} from '@shopify/hydrogen';

export class AppSession implements HydrogenSession {
  public isPending = false;
  #sessionStorage;
  #session;

  static async init(request: Request, secrets: string[]) {
    const storage = createCookieSessionStorage({
      cookie: {
        name: 'session',
        httpOnly: true,    // JS cannot read it
        path: '/',
        sameSite: 'lax',   // Blocks cross-site POSTs; allows same-site navigations
        secrets,           // HMAC-signed with SESSION_SECRET from context.env
        // secure: not set — Oxygen enforces HTTPS at the edge in production
      },
    });
    const session = await storage
      .getSession(request.headers.get('Cookie'))
      .catch(() => storage.getSession());
    return new this(storage, session);
  }

  // set/get/unset/commit/destroy — delegate to #session and #sessionStorage
}
```

**Initialize in `server.ts` using `context.env.SESSION_SECRET`:**
```ts
const session = await AppSession.init(request, [env.SESSION_SECRET]);
```

---

## 8. Security Layers

Three defences, applied in order in every `action()` that mutates data:

### Layer 1 — CSRF (blocks cross-origin attacks)

```ts
// app/lib/csrf.server.ts
import {CSRF} from 'remix-utils/csrf/server';
import {createCookie} from 'react-router';

const cookie = createCookie('csrf', {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production', // build-time constant — safe
});

export const csrf = new CSRF({cookie});
```

**Root loader — generate token and set cookie:**
```ts
// app/root.tsx
export async function loader(args: Route.LoaderArgs) {
  const [csrfToken, csrfCookie] = await csrf.commitToken(args.request);

  return data(
    {...otherData, csrfToken},
    csrfCookie ? {headers: {'Set-Cookie': csrfCookie}} : undefined,
  );
}
```

**Root App component — provide token to all forms:**
```tsx
import {AuthenticityTokenProvider} from 'remix-utils/csrf/react';

export default function App() {
  const data = useRouteLoaderData<RootLoader>('root');
  return (
    <AuthenticityTokenProvider token={data?.csrfToken ?? ''}>
      {/* rest of the app */}
    </AuthenticityTokenProvider>
  );
}
```

**In every form:**
```tsx
import {AuthenticityTokenInput} from 'remix-utils/csrf/react';

<Form method="post">
  <AuthenticityTokenInput />   {/* renders <input type="hidden" name="csrf" value="..." /> */}
  {/* other fields */}
</Form>
```

**In every action:**
```ts
import {CSRFError} from 'remix-utils/csrf/server';
import {csrf} from '~/lib/csrf.server';

export async function action({request, context}: ActionFunctionArgs) {
  try {
    await csrf.validate(request);   // clones request internally — formData() still works below
  } catch (error) {
    if (error instanceof CSRFError) {
      return {error: 'Invalid security token. Please reload and try again.'};
    }
    throw error;
  }
  // ...
}
```

### Layer 2 — Authentication (blocks anonymous abuse)

```ts
const isLoggedIn = await context.customerAccount.isLoggedIn();
if (!isLoggedIn) {
  return {error: 'You must be logged in.'};
}
```

### Layer 3 — IP Rate Limiting (limits replay spam)

```ts
// Module-level Map — persists for Worker process lifetime
const submissions = new Map<string, {count: number; resetAt: number}>();
const LIMIT = 5;
const WINDOW = 60_000; // 1 minute

function rateLimit(ip: string) {
  const now = Date.now();
  const e = submissions.get(ip);
  if (!e || now > e.resetAt) {
    submissions.set(ip, {count: 1, resetAt: now + WINDOW});
    return {allowed: true, remaining: LIMIT - 1};
  }
  if (e.count >= LIMIT) {
    return {allowed: false, remaining: 0};
  }
  e.count++;
  return {allowed: true, remaining: LIMIT - e.count};
}

// In action:
const ip =
  request.headers.get('cf-connecting-ip') ??
  request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
  'unknown';
const {allowed} = rateLimit(ip);
if (!allowed) return {error: 'Too many requests.'};
```

> **Production note:** The module-level Map resets on cold starts and doesn't share state across Cloudflare Worker instances. Replace with **Cloudflare Rate Limiting rules** in the dashboard for true distributed limiting.

---

## 9. Third-Party API Integration (credential isolation)

The core rule: **API keys live only in `context.env`. They are read only inside `loader()` or `action()`. Neither function has a client bundle.**

```
Browser          Hydrogen Worker          Third-Party API
  │                    │                        │
  │── GET /page ──────>│                        │
  │                    │── fetch + x-api-key ──>│
  │                    │<── response ───────────│
  │<── HTML (no key) ──│                        │
```

**Resource route — read-only proxy:**
```ts
// app/routes/api/reviews.ts
export async function loader({request, context}: LoaderFunctionArgs) {
  const {REVIEW_API_URL, REVIEW_API_KEY} = context.env as Env;
  const productId = new URL(request.url).searchParams.get('productId');
  const res = await fetch(`${REVIEW_API_URL}/api/reviews?productId=${productId}`, {
    headers: {'x-api-key': REVIEW_API_KEY},
  });
  return Response.json(await res.json(), {status: res.status});
}
// NO action export — POST to this URL returns 405
```

**Write via page action (not the resource route):**
```ts
// app/routes/reviews-demo/index.tsx
export async function action({request, context}: ActionFunctionArgs) {
  await csrf.validate(request);
  const {REVIEW_API_URL, REVIEW_API_KEY} = context.env as Env;
  const fd = await request.formData();
  const res = await fetch(`${REVIEW_API_URL}/api/reviews`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-api-key': REVIEW_API_KEY},
    body: JSON.stringify(Object.fromEntries(fd)),
  });
  return res.json();
}
```

---

## 10. Global UI — CSS Variables & Colors

Defined in `app/styles/app.css`. **Extend these in a new project, don't add hardcoded values to components.**

```css
:root {
  /* Layout */
  --aside-width: 400px;
  --cart-aside-summary-height: 250px;
  --cart-aside-summary-height-with-discount: 300px;
  --header-height: 64px;
  --grid-item-width: 355px;

  /* Colors — intentionally minimal (black/white base, Tailwind for everything else) */
  --color-dark: #000;
  --color-light: #fff;
}
```

**Where each variable is used:**

| Variable | Used by |
|---|---|
| `--aside-width` | `Aside` slide panel, cart summary positioning |
| `--header-height` | Sticky header, search panel offset |
| `--grid-item-width` | Collections grid, products grid, blog grid (`minmax(var(--grid-item-width), 1fr)`) |
| `--color-dark` | Footer background, borders, header borders |
| `--color-light` | Aside background, header background, predictive search |

**Tailwind v4** is the primary utility layer. The CSS variables above handle the structural values that can't be expressed as Tailwind classes (viewport-aware heights, dynamic `calc()` expressions).

**Pattern for adding brand colors in a new project:**
```css
:root {
  /* Keep the structural vars above, add brand vars here */
  --color-brand:       #0057FF;
  --color-brand-dark:  #0040CC;
  --color-brand-light: #E8F0FF;
  --color-text:        #111;
  --color-muted:       #666;
  --color-border:      #E5E5E5;
  --color-surface:     #F9F9F9;
}
```

---

## 11. CSS Architecture — Two-Layer System

This project uses **CSS variables + Tailwind v4**, not one or the other.

| Layer | What it does | Where |
|---|---|---|
| `app.css` | Structural layout, component-scoped CSS, CSS variables | Shared patterns that can't be Tailwind utilities |
| Tailwind v4 | Utility classes in JSX | Feature-specific, one-off styles |

**Rules:**
- Use **Tailwind classes** for: spacing, typography, colors on new components, hover/focus states, responsive breakpoints.
- Use **`app.css` with CSS classes** for: layout components that appear everywhere (header, aside, cart), patterns driven by CSS custom properties (calc-based heights).
- Never mix both for the same element — pick one per component.
- Never use inline `style={}` for anything structural.

**Responsive breakpoints (match the existing ones):**

| Breakpoint | Value | Used for |
|---|---|---|
| Mobile → Desktop | `45em` | Header menu, product grid, featured collection |
| Mobile → Desktop | `48em` | Header mobile toggle |

---

## 12. Common Components Reference

### `<PageLayout>` — Root shell

Wraps every page. Provides:
- `<Aside.Provider>` — React context for slide panels
- `<CartAside>` — Cart slide panel with streaming
- `<SearchAside>` — Predictive search slide panel
- `<MobileMenuAside>` — Mobile nav slide panel
- `<Header>` — Sticky top bar
- `<main>` — Page content (`<Outlet />`)
- `<Footer>` — Footer with streaming nav links

```tsx
// Already wired in root.tsx — you don't render this yourself
<PageLayout cart={cart} footer={footer} header={header} isLoggedIn={isLoggedIn} publicStoreDomain={...}>
  <Outlet />
</PageLayout>
```

### `<Aside>` — Slide panel

```tsx
import {Aside, useAside} from '~/components/Aside';

// Declare a panel (in PageLayout or a layout component)
<Aside type="cart" heading="CART">
  <CartMain />
</Aside>

// Open it from anywhere
const {open} = useAside();
<button onClick={() => open('cart')}>Open Cart</button>

// Aside types: 'cart' | 'search' | 'mobile' | 'closed'
```

`Aside.Provider` must wrap all usage. It's already in `PageLayout`. Do not add another one.

### `<PaginatedResourceSection>` — Cursor pagination

```tsx
import {PaginatedResourceSection} from '~/components/PaginatedResourceSection';

<PaginatedResourceSection connection={productsConnection}>
  {({node}) => <ProductItem product={node} />}
</PaginatedResourceSection>
```

`connection` must be a Storefront API connection (`{edges: [{node}], pageInfo: {hasNextPage, endCursor}}`).

### `<ProductPrice>` — Sale price display

```tsx
<ProductPrice price={product.priceRange.minVariantPrice} compareAtPrice={product.compareAtPriceRange?.minVariantPrice} />
```

Handles the sale price strikethrough automatically.

### `<ProductForm>` — Variant selector + Add to cart

```tsx
<ProductForm product={product} selectedVariant={selectedVariant} variants={variants} />
```

Reads `?Size=Large&Color=Red` from the URL via `useSearchParams`. Uses `<AddToCartButton>` internally with optimistic cart updates.

### `<AddToCartButton>` — Optimistic cart

```tsx
import {AddToCartButton} from '~/components/AddToCartButton';
import {useAside} from '~/components/Aside';

const {open} = useAside();
<AddToCartButton
  lines={[{merchandiseId: variant.id, quantity: 1}]}
  onClick={() => open('cart')}
>
  Add to cart
</AddToCartButton>
```

### `<SearchFormPredictive>` — Render-prop search input

```tsx
<SearchFormPredictive>
  {({fetchResults, goToSearch, inputRef}) => (
    <input ref={inputRef} type="search" onChange={fetchResults} onFocus={fetchResults} />
  )}
</SearchFormPredictive>
```

---

## 13. Root Loader — What It Returns

Every page receives these from the root loader (via `useRouteLoaderData<RootLoader>('root')`):

| Key | Type | Description |
|---|---|---|
| `header` | `HeaderQuery` | Shop name, primary domain, main menu |
| `footer` | `Promise<FooterQuery \| null>` | Footer menu (deferred) |
| `cart` | `Promise<CartApiQueryFragment \| null>` | Cart (deferred) |
| `isLoggedIn` | `Promise<boolean>` | Customer auth status (deferred) |
| `publicStoreDomain` | `string` | `PUBLIC_STORE_DOMAIN` env var |
| `shop` | Analytics shop object | For `<Analytics.Provider>` |
| `consent` | Consent object | For `<Analytics.Provider>` |
| `csrfToken` | `string` | CSRF token for `<AuthenticityTokenProvider>` |

**`shouldRevalidate` is set to `false` by default** in `root.tsx` for performance — the root loader only re-runs after mutations or manual `useRevalidator`. Be aware: if you add data to the root loader that changes frequently, you may need to adjust this.

---

## 14. GraphQL — Storefront API

### Fragments in `app/lib/fragments.ts`

```ts
import {gql} from 'graphql-tag';

export const HEADER_QUERY = `#graphql
  query Header($headerMenuHandle: String!, $language: LanguageCode, $country: CountryCode)
  @inContext(language: $language, country: $country) {
    shop { name primaryDomain { url } }
    menu(handle: $headerMenuHandle) { ... }
  }
`;
```

### Codegen — always run after changing queries

```bash
npm run codegen
```

This generates `storefrontapi.generated.ts` with full TypeScript types for every query/mutation. Import from it directly:
```ts
import type {ProductQuery, ProductFragment} from 'storefrontapi.generated';
```

### Caching

```ts
// Long (CacheLong) — navigation data, menus, collections
const data = await storefront.query(HEADER_QUERY, {
  cache: storefront.CacheLong(),
});

// Short (CacheShort) — frequently changing data
const data = await storefront.query(CART_QUERY, {
  cache: storefront.CacheShort(),
});

// No cache — user-specific or mutation results
const data = await storefront.query(CUSTOMER_QUERY, {
  cache: storefront.CacheNone(),
});
```

---

## 15. Analytics

```tsx
// Already wired in root.tsx App() component
<Analytics.Provider cart={data.cart} shop={data.shop} consent={data.consent}>
  <PageLayout>{/* ... */}</PageLayout>
</Analytics.Provider>
```

Track custom page views or events from any route component:
```ts
import {useAnalytics} from '@shopify/hydrogen';

const {publish} = useAnalytics();
publish('custom_event', {productId: 'abc'});
```

---

## 16. i18n — Locale

The locale wrapper at `routes/($locale).tsx` sets `context.storefront.i18n`. Every Storefront API query is automatically localized.

To get the current locale in a component:
```ts
import {useRootLoaderData} from '~/lib/...'; // or useRouteLoaderData
const {header} = useRouteLoaderData<RootLoader>('root');
```

For URL-based locale switching, the `i18n.ts` helper handles the prefix logic.

---

## 17. TypeScript Rules

1. **Never use `any`** — use `unknown` and narrow it.
2. **Always cast `context.env`:** `const {KEY} = context.env as Env;`
3. **Loader/action return types** are inferred by React Router — use `typeof loader` as the type argument: `useLoaderData<typeof loader>()`.
4. **Generated types** from codegen are the source of truth for Storefront API shapes.
5. **`@total-typescript/ts-reset`** is installed — it fixes `JSON.parse` returning `unknown`, `Array.filter(Boolean)` narrowing properly, etc.

---

## 18. New Project Checklist

When starting a fresh Hydrogen project, do these in order:

- [ ] Run `npx @shopify/create-hydrogen@latest` and choose the skeleton template
- [ ] Copy the `routes.ts` pattern from this project (manual config, not file-based)
- [ ] Create `docs/` folder and copy this guide as your reference
- [ ] Declare all env vars in `env.d.ts` under `interface Env`
- [ ] Add `SESSION_SECRET` to `.env` and to Oxygen dashboard secrets
- [ ] Install `remix-utils @oslojs/crypto @oslojs/encoding --legacy-peer-deps`
- [ ] Create `app/lib/csrf.server.ts` and wire up `AuthenticityTokenProvider` in `root.tsx`
- [ ] Set up `app/styles/app.css` with the CSS variables from Section 10
- [ ] Add Tailwind v4 (`@import 'tailwindcss'` in `tailwind.css`, `@tailwindcss/vite` in vite config)
- [ ] Run `npm run codegen` after adding any GraphQL query
- [ ] Every `action()` that mutates: CSRF validate → auth check → rate limit → formData → upstream
- [ ] Every third-party API key: only in `context.env`, only read in `loader()` / `action()`
- [ ] Deferred data: always `.catch(() => null)` so errors don't 500 the page
- [ ] Session cookie: `httpOnly: true`, `sameSite: 'lax'`, `secrets: [env.SESSION_SECRET]`
- [ ] Before deploy: run `npm run build` and fix all TypeScript errors

---

## 19. Common Mistakes to Avoid

| Mistake | Correct Pattern |
|---|---|
| `process.env.MY_KEY` in a loader | `(context.env as Env).MY_KEY` |
| Throwing inside deferred data | `.catch(() => null)` — let the page render |
| Adding a POST `action` to a resource route | Writes go through the page's `action()` |
| Forgetting `<AuthenticityTokenInput />` in a form | Every `<Form method="post">` needs one |
| Reading `request.formData()` before `csrf.validate()` | `validate()` clones — always call it first and read formData after |
| Putting business logic in components | Business logic goes in `loader()` / `action()` / `lib/` |
| Using `useEffect` to fetch data on mount | Use `loader()` for critical data, `useFetcher.load()` for lazy |
| Hardcoding breakpoints in JSX | Use Tailwind responsive classes (`md:`, `lg:`) or CSS media queries |
| Adding secrets to Vite `define` | Only `NODE_ENV`-style build constants belong there; runtime secrets live in `context.env` |
