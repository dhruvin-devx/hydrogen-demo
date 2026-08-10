# 02 — Folder Structure

## Top-Level Layout

```
hydrogen-demo/
├── app/                         # All application code lives here
│   ├── components/              # Reusable UI components
│   ├── lib/                     # Utilities, context, helpers
│   ├── routes/                  # File-based route files
│   ├── styles/                  # Global CSS / Tailwind imports
│   └── root.tsx                 # App root layout (html, head, body)
│
├── public/                      # Static assets (favicon, robots.txt)
├── server.ts                    # Edge worker entry point (Oxygen)
├── react-router.config.ts       # React Router + Hydrogen preset config
├── vite.config.ts               # Vite build config
├── env.d.ts                     # TypeScript types for env variables
├── storefrontapi.generated.d.ts # Auto-generated Storefront API types
└── package.json
```

## `app/` Directory Deep Dive

### `app/routes/` — the heart of the app

Each file = one URL. Hydrogen uses React Router's **flat routes** convention.

```
routes/
├── ($locale)._index.tsx             # /  (homepage)
├── ($locale).products.$handle.tsx   # /products/:handle
├── ($locale).collections.$handle.tsx
├── ($locale).collections._index.tsx # /collections
├── ($locale).cart.tsx               # /cart
├── ($locale).cart.$lines.tsx        # /cart/:lines (cart permalink)
├── ($locale).blogs.$blogHandle.$articleHandle.tsx
├── ($locale).policies.$handle.tsx
├── ($locale).[sitemap.xml].tsx      # sitemap
├── ($locale).$.tsx                  # catch-all / 404
│
├── ($locale).account/               # Account section (folder = layout route)
│   ├── route.tsx                    # Layout wrapper
│   ├── _index.tsx                   # /account
│   ├── orders._index.tsx            # /account/orders
│   ├── orders.$id.tsx               # /account/orders/:id
│   ├── profile.tsx                  # /account/profile
│   └── addresses.tsx                # /account/addresses
│
└── ($locale).account_/              # Auth routes (separate from account layout)
    ├── login.tsx
    ├── logout.tsx
    └── authorize.tsx
```

**File naming rules:**

| Pattern | Meaning |
|---------|---------|
| `_index.tsx` | Index route (renders when no child matches) |
| `$handle.tsx` | Dynamic segment → `params.handle` |
| `($locale).` | Optional segment → `params.locale` |
| `[sitemap.xml].tsx` | Escaped segment (dots) → literal URL `/sitemap.xml` |
| `folder/route.tsx` | Layout route (wraps children with `<Outlet>`) |
| `_.tsx` / `$.tsx` | Catch-all route |

### `app/components/`

Organise by function, not by route:

```
components/
├── ui/                    # Purely presentational (no data fetching)
│   ├── Button.tsx
│   ├── Badge.tsx
│   └── Input.tsx
│
├── ProductItem.tsx        # Product card used across multiple routes
├── PaginatedResourceSection.tsx
├── MockShopNotice.tsx
├── Header.tsx             # Shared layout parts
└── Footer.tsx
```

**Rule:** components in `ui/` accept only props. Components outside `ui/` may use `useLoaderData` or Hydrogen hooks.

### `app/lib/`

Server-side utilities and shared helpers:

```
lib/
├── context.ts             # createHydrogenRouterContext — wires storefront, cart, session
├── fragments.ts           # Shared GraphQL fragments (ProductItem, MoneyFragment)
├── redirect.ts            # redirectIfHandleIsLocalized
├── variants.ts            # Variant selection helpers
└── third-party/
    ├── createCmsClient.server.ts
    └── createAnalyticsClient.server.ts
```

The `.server.ts` suffix is a **convention** (not enforced by the framework) to signal the file should never be imported on the client side.

### `app/root.tsx`

The app shell — always rendered, wraps every route:

```tsx
// app/root.tsx skeleton
export async function loader({ context }: Route.LoaderArgs) {
  const [cart, shop] = await Promise.all([
    context.cart.get(),
    context.storefront.query(SHOP_QUERY),
  ]);
  return { cart, shop, consent: await context.customerPrivacy.getConsent() };
}

export default function App() {
  const { cart, shop, consent } = useLoaderData<typeof loader>();
  return (
    <Analytics.Provider cart={cart} shop={shop} consent={consent}>
      <Outlet />                 {/* route content renders here */}
    </Analytics.Provider>
  );
}

export function ErrorBoundary() {
  return <GeneralError />;      {/* global error UI */}
}
```

### `server.ts` — Edge Worker Entry

```ts
// server.ts (production pattern — matches this project)
import * as serverBuild from 'virtual:react-router/server-build';
import { createRequestHandler, storefrontRedirect } from '@shopify/hydrogen';
import { createHydrogenRouterContext } from '~/lib/context';

export default {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext) {
    const hydrogenContext = await createHydrogenRouterContext(request, env, executionContext);

    const handleRequest = createRequestHandler({
      build: serverBuild,
      mode: process.env.NODE_ENV,
      getLoadContext: () => hydrogenContext,  // passed to every loader/action
    });

    const response = await handleRequest(request);

    if (hydrogenContext.session.isPending) {
      response.headers.set('Set-Cookie', await hydrogenContext.session.commit());
    }

    if (response.status === 404) {
      return storefrontRedirect({ request, response, storefront: hydrogenContext.storefront });
    }

    return response;
  },
};
```

### `react-router.config.ts`

```ts
import { hydrogenPreset } from '@shopify/hydrogen/react-router-preset';

export default {
  presets: [hydrogenPreset()],  // enables Oxygen SSR + Hydrogen optimisations
} satisfies Config;
```

### `vite.config.ts`

```ts
export default defineConfig({
  plugins: [
    tailwindcss(),
    hydrogen(),     // Hydrogen Vite plugin (SSR, HMR, codegen watcher)
    oxygen(),       // mini-oxygen local dev server
    reactRouter(),  // React Router Vite plugin
  ],
  resolve: {
    alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) },
  },
});
```

### `env.d.ts` — Environment Variable Types

```ts
interface Env {
  SESSION_SECRET: string;
  PUBLIC_STORE_DOMAIN: string;       // e.g. my-store.myshopify.com
  PUBLIC_STOREFRONT_API_TOKEN: string;
  PUBLIC_STOREFRONT_API_VERSION: string;
  PRIVATE_STOREFRONT_API_TOKEN?: string;
  PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID: string;
  PUBLIC_CUSTOMER_ACCOUNT_API_URL: string;
}
```

## Production Additions

For a real storefront, add these to the structure:

```
app/
├── lib/
│   ├── seo.ts               # Structured data / meta tag helpers
│   └── i18n.ts              # Locale / currency helpers
├── components/
│   ├── Seo.tsx              # Per-route <meta> tags
│   └── RichText.tsx         # CMS content renderer
public/
├── fonts/                   # Self-hosted fonts
└── icons/                   # SVG sprites
```
