# 13 — Security Best Practices

---

## 1. Never Return `context` or `env` From a Loader

```ts
// ✗ NEVER do this
export async function loader({ context }: Route.LoaderArgs) {
  return { context };       // exposes session, env, storefront client — everything
}

// ✗ also wrong
export async function loader({ context }: Route.LoaderArgs) {
  return { env: context.env };  // exposes SESSION_SECRET, PRIVATE_TOKEN, etc.
}
```

`context` and `env` are server-only objects. When you return something from a loader, React Router serializes it to JSON and sends it to the browser inside a `<script>` tag. **Whatever you return is readable by the client.** Returning `context` or `env` exposes:

- `SESSION_SECRET` — allows cookie forgery, any user can be impersonated
- `PRIVATE_STOREFRONT_API_TOKEN` — exposes your private Shopify API credentials
- `session` internals — exposes all session data of every user

**Fix: return only the data the component needs.**

```ts
// ✓ correct — return only what the UI renders
export async function loader({ context }: Route.LoaderArgs) {
  const { storefront, env } = context;

  const { product } = await storefront.query(PRODUCT_QUERY, {
    variables: { handle: 'cool-shirt' },
  });

  return {
    product,                              // ✓ safe — public product data
    storeDomain: env.PUBLIC_STORE_DOMAIN, // ✓ safe — PUBLIC_ prefix means it's intended for the browser
    // env.PRIVATE_STOREFRONT_API_TOKEN   // ✗ never return this
    // context.session                    // ✗ never return this
  };
}
```

---

## 2. Environment Variables — `PUBLIC_` vs `PRIVATE_`

Hydrogen enforces a naming convention that maps to where the variable is allowed to go:

| Prefix | Who can read it | Where it flows |
|---|---|---|
| `PUBLIC_` | Browser + server | Embedded in client JS bundle at build time via Vite |
| `PRIVATE_` or no prefix | Server only | Injected by Cloudflare at runtime — never bundled |

```bash
# Safe to expose to the browser
PUBLIC_STORE_DOMAIN=mystore.myshopify.com
PUBLIC_STOREFRONT_API_TOKEN=abc123        # read-only, intentionally public
PUBLIC_CHECKOUT_DOMAIN=checkout.mystore.com

# Never leaves the server — Cloudflare injects at runtime only
PRIVATE_STOREFRONT_API_TOKEN=secret_xyz   # never send to client
SESSION_SECRET=long_random_string         # never send to client
```

### How the isolation works

On the server, every var arrives as a parameter — Cloudflare injects it at runtime:

```ts
// server.ts
export default {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext) {
    // env.PRIVATE_STOREFRONT_API_TOKEN is available here
    // env.SESSION_SECRET is available here
    // Neither will ever appear in the client JS bundle
  }
}
```

`env` is **never bundled into your JS.** Even if an attacker decompiles your worker bundle, your secrets are not in it — they live in Cloudflare's encrypted secret store and are injected at the edge at request time.

On the client, Vite only embeds `PUBLIC_` vars:

```ts
// Browser code
import.meta.env.PUBLIC_STORE_DOMAIN          // → 'mystore.myshopify.com' ✓
import.meta.env.PRIVATE_STOREFRONT_API_TOKEN // → undefined (Vite strips it) ✓
```

### Always access env through `context.env` in loaders — not `import.meta.env`

```ts
// ✓ correct — runtime injection, available only on server
export async function loader({ context }: Route.LoaderArgs) {
  const token = context.env.PRIVATE_STOREFRONT_API_TOKEN;
}

// ✗ wrong — build-time embed, creates confusion, will be undefined for PRIVATE_ vars
export async function loader({ context }: Route.LoaderArgs) {
  const token = import.meta.env.PRIVATE_STOREFRONT_API_TOKEN;
}
```

---

## 3. Type Every Env Var You Use

Declare all your vars in `env.d.ts`. TypeScript will error at build time when a var is missing — rather than a silent `undefined` in production.

```ts
// env.d.ts
/// <reference types="vite/client" />
/// <reference types="react-router" />
/// <reference types="@shopify/oxygen-workers-types" />
/// <reference types="@shopify/hydrogen/react-router-types" />

import '@total-typescript/ts-reset';

declare global {
  interface Env {
    // Shopify / Oxygen (injected automatically)
    SESSION_SECRET: string;
    PUBLIC_STOREFRONT_API_TOKEN: string;
    PRIVATE_STOREFRONT_API_TOKEN: string;
    PUBLIC_STORE_DOMAIN: string;
    PUBLIC_STOREFRONT_ID: string;
    PUBLIC_CHECKOUT_DOMAIN: string;

    // Your custom vars — add them here
    // KLAVIYO_API_KEY: string;
    // CMS_ACCESS_TOKEN: string;
    // PUBLIC_GOOGLE_ANALYTICS_ID: string;
  }
}
```

Once declared, `context.env.SOME_UNDEFINED_VAR` is a TypeScript compile error, not a runtime `undefined`.

---

## 4. Validate Env Vars at Startup — Fail Fast

Your `context.ts` already validates `SESSION_SECRET`. Extend this to all required vars so a misconfigured deployment crashes immediately on the first request with a clear message — not silently mid-user-session.

```ts
// app/lib/env.ts
export function validateEnv(env: Env) {
  const required = [
    'SESSION_SECRET',
    'PUBLIC_STORE_DOMAIN',
    'PUBLIC_STOREFRONT_API_TOKEN',
    'PRIVATE_STOREFRONT_API_TOKEN',
  ] as const;

  const missing = required.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Check your .env file (local) or Oxygen dashboard (production).`,
    );
  }
}
```

Call it at the top of `createHydrogenRouterContext`:

```ts
// app/lib/context.ts
import {validateEnv} from '~/lib/env';

export async function createHydrogenRouterContext(request, env, executionContext) {
  validateEnv(env); // crashes immediately if anything is missing
  // ...
}
```

---

## 5. `SESSION_SECRET` Must Be Long and Random

Your current `.env` has:

```bash
SESSION_SECRET="foobar"  # ← fine for local dev, catastrophic in production
```

`SESSION_SECRET` is the HMAC signing key for all session cookies. If an attacker knows this value, they can craft valid session cookies for any customer — instant full-store account takeover.

**Generate a proper secret:**

```bash
openssl rand -hex 32
# a3f8d92c1b4e6f7a0d5c8e2b9f1a4d7e3c6b9f2a5d8e1b4c7f0a3d6e9b2c5f8
```

Set this in the **Shopify Oxygen dashboard** (not in your `.env` — the `.env` value only affects local MiniOxygen).

---

## 6. `.env` File Rules

The `.env` file is read only by MiniOxygen (local dev). It is never deployed to Cloudflare. Production secrets are set in the Oxygen dashboard.

```bash
# .env — local dev only
SESSION_SECRET="any-random-string-for-local-dev"
PUBLIC_STORE_DOMAIN="yourstore.myshopify.com"
PUBLIC_STOREFRONT_API_TOKEN="your-dev-storefront-token"
PRIVATE_STOREFRONT_API_TOKEN="your-dev-private-token"
PUBLIC_STOREFRONT_ID="your-storefront-id"
PUBLIC_CHECKOUT_DOMAIN="checkout.yourstore.com"
```

**Rules:**

1. **`.env` must be gitignored.** Verify it:
   ```bash
   git check-ignore -v .env
   # must output a line — if blank, .env is not ignored
   ```

2. **Use separate tokens for dev and production.** Create a "Development" Storefront API token in Shopify Admin with the same scopes. If it leaks via git history, production is unaffected.

3. **Never put production secrets in `.env`.** Git history is permanent — even a single accidental commit means you must rotate the secret.

To sync `PUBLIC_` vars from your linked Oxygen storefront into `.env`:

```bash
npx shopify hydrogen env pull
# PRIVATE_ vars are NOT pulled — they stay server-side only
```

---

## 7. Risk Level of Each Var

| Variable | Risk if leaked | Impact |
|---|---|---|
| `SESSION_SECRET` | **Critical** | Cookie forgery — attacker impersonates any customer |
| `PRIVATE_STOREFRONT_API_TOKEN` | **High** | Direct high-rate Storefront API access bypassing your server |
| `PUBLIC_STOREFRONT_API_TOKEN` | **None** | Intentionally public, read-only, rate-limited |
| `PUBLIC_STORE_DOMAIN` | **None** | Visible in network requests anyway |

---

## 8. Common Mistakes Checklist

```
✗ return { context }         from a loader — exposes entire context object
✗ return { env }             from a loader — exposes all secrets
✗ console.log(context.env)   in any loader — secrets in server logs
✗ SESSION_SECRET="foobar"    in production — cookie forgery possible
✗ PRIVATE_ token in client component — violates server/client boundary
✗ .env committed to git      — rotate all secrets immediately
✗ hardcoding tokens in source — same as committing to git
```

```
✓ return only { product, customer, ... }   — specific data the component needs
✓ access env via context.env in loaders    — server-only, never bundled
✓ PUBLIC_ only for truly public values     — domain names, public tokens
✓ validateEnv() at startup                 — fail fast with a clear message
✓ SESSION_SECRET from openssl rand -hex 32 — cryptographically random
✓ .env in .gitignore                       — verify with git check-ignore
✓ separate dev/prod Shopify API tokens     — blast radius isolation
```

---

## 9. Content Security Policy (CSP)

### What CSP Does

A Content Security Policy tells the browser which origins are allowed to load scripts, styles, images, fonts, and connections. If an attacker injects a `<script>` tag via XSS, the browser checks it against the policy and **refuses to run it** even if it made it into the HTML.

Without CSP, one XSS vulnerability can steal session cookies, exfiltrate cart data, or inject payment skimmers. With CSP, the attack is blocked at the browser level.

### How Hydrogen Implements CSP — Per-Request Nonce

Hydrogen uses a **nonce-based CSP** rather than a domain allowlist. A nonce is a random string generated fresh on every request. The browser only executes scripts that carry the matching nonce attribute.

The full flow across your three files:

**`app/entry.server.tsx`** — generates the nonce and sets the CSP header:

```ts
// app/entry.server.tsx
import {createContentSecurityPolicy} from '@shopify/hydrogen';

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
  context,
) {
  const {nonce, header, NonceProvider} = createContentSecurityPolicy({
    shop: {
      checkoutDomain: context.env.PUBLIC_CHECKOUT_DOMAIN,
      storeDomain: context.env.PUBLIC_STORE_DOMAIN,
    },
  });

  const body = await renderToReadableStream(
    <NonceProvider>
      <ServerRouter context={reactRouterContext} url={request.url} nonce={nonce} />
    </NonceProvider>,
    {
      nonce,           // React stamps this nonce on every <script> tag it renders
      signal: request.signal,
      onError(error) { responseStatusCode = 500; },
    },
  );

  responseHeaders.set('Content-Type', 'text/html');
  responseHeaders.set('Content-Security-Policy', header);  // CSP header on every response

  return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}
```

**`app/root.tsx`** — propagates the nonce to React Router's script tags:

```tsx
// app/root.tsx
import {useNonce} from '@shopify/hydrogen';
import {Scripts, ScrollRestoration} from 'react-router';

export function Layout({children}: {children: React.ReactNode}) {
  const nonce = useNonce(); // reads nonce from NonceProvider context

  return (
    <html>
      <head>...</head>
      <body>
        {children}
        <ScrollRestoration nonce={nonce} />  {/* stamps nonce on inline script */}
        <Scripts nonce={nonce} />            {/* stamps nonce on all script tags */}
      </body>
    </html>
  );
}
```

**`app/entry.client.tsx`** — reads the nonce back from the DOM for client-side scripts:

```tsx
// app/entry.client.tsx
if (!window.location.origin.includes('webcache.googleusercontent.com')) {
  startTransition(() => {
    // React can't read the server's NonceProvider after hydration,
    // so read the nonce from an existing <script nonce="..."> in the DOM
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

### What the Generated CSP Header Looks Like

`createContentSecurityPolicy` with your shop domains generates roughly:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'nonce-xK9pL2mR8vQ3' 'strict-dynamic' https://cdn.shopify.com https://checkout.mystore.com;
  style-src 'self' 'unsafe-inline' https://cdn.shopify.com;
  img-src 'self' data: https://cdn.shopify.com https://mystore.myshopify.com;
  connect-src 'self' https://mystore.myshopify.com https://checkout.mystore.com;
  font-src 'self' https://cdn.shopify.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self'
```

Key directives:
- **`script-src 'nonce-xK9pL2mR8vQ3'`** — only scripts with this exact nonce execute. Changes every request.
- **`'strict-dynamic'`** — scripts loaded by a nonced script are trusted automatically (needed for React Router's code splitting)
- **`frame-ancestors 'none'`** — blocks clickjacking (your store can't be embedded in an iframe)
- **`base-uri 'self'`** — prevents `<base>` tag injection attacks

### Adding Third-Party Scripts to CSP

Every external domain you load scripts, fonts, or images from must be added to the CSP. If it's missing, the browser silently blocks the resource.

```ts
// app/entry.server.tsx
const {nonce, header, NonceProvider} = createContentSecurityPolicy({
  shop: {
    checkoutDomain: context.env.PUBLIC_CHECKOUT_DOMAIN,
    storeDomain: context.env.PUBLIC_STORE_DOMAIN,
  },

  // Add third-party domains here
  scriptSrc: [
    'https://www.googletagmanager.com',    // Google Analytics
    'https://static.klaviyo.com',          // Klaviyo
  ],
  imgSrc: [
    'https://www.google-analytics.com',
    'https://i.ytimg.com',                 // YouTube thumbnails
  ],
  connectSrc: [
    'https://www.google-analytics.com',
    'https://region1.analytics.google.com',
  ],
  frameSrc: [
    'https://www.youtube.com',             // YouTube embeds
  ],
  fontSrc: [
    'https://fonts.gstatic.com',           // Google Fonts
  ],
  styleSrc: [
    'https://fonts.googleapis.com',        // Google Fonts CSS
  ],
});
```

### CSP Violations — How to Debug

When the browser blocks something, it logs to the DevTools console:

```
Refused to execute inline script because it violates the following
Content Security Policy directive: "script-src 'nonce-abc123'..."
```

**Common causes and fixes:**

| Symptom | Cause | Fix |
|---|---|---|
| Third-party widget is blank | Its domain not in `scriptSrc`/`connectSrc` | Add the domain to `createContentSecurityPolicy` |
| Google Fonts not loading | `fonts.googleapis.com` not in `styleSrc` | Add to `styleSrc` and `fontSrc` |
| Inline `<script>` blocked | Script has no nonce | Use `useNonce()` hook and pass nonce to the script |
| YouTube embed broken | `youtube.com` not in `frameSrc` | Add to `frameSrc` |
| Analytics not firing | Analytics endpoint not in `connectSrc` | Add to `connectSrc` |

### Adding a Nonce to Your Own Inline Scripts

If you write a custom inline script (e.g. a third-party chat widget initializer), it needs the nonce:

```tsx
// app/root.tsx or any route component
import {useNonce} from '@shopify/hydrogen';

export function Layout({children}: {children: React.ReactNode}) {
  const nonce = useNonce();

  return (
    <html>
      <head>
        {/* ✓ nonce makes this script pass CSP */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `window.MyWidget = { apiKey: 'pub_abc123' }`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

Without the nonce, the inline script is blocked even if the domain is in the allowlist.

### Why Nonce-Based CSP Is Better Than Domain Allowlists

A domain allowlist (`script-src https://cdn.example.com`) trusts **all** scripts from that domain. If `cdn.example.com` is ever compromised, an attacker can serve malicious JS and your CSP won't block it.

A nonce-based policy trusts **only the specific scripts your server rendered**. An attacker who injects a `<script>` tag — even from a trusted domain — gets blocked because they don't know the nonce for this request.

```
Request 1: nonce = "xK9pL2"  → expires after this response
Request 2: nonce = "m3vQ7n"  → new random nonce, attacker's injected script still blocked
```

This is why `createContentSecurityPolicy` generates a fresh nonce per request rather than using a fixed value.

### CSP in Development vs Production

In development (MiniOxygen), the CSP header is still set but may be slightly more permissive to allow HMR (Vite's hot module reload uses WebSockets and inline scripts). In production on Oxygen, the full policy is enforced.

If you need to temporarily relax CSP to debug a third-party integration, add the domain to `createContentSecurityPolicy` first — never disable CSP entirely.

---

## Quick Reference

```
How each var is accessed and where it ends up
──────────────────────────────────────────────────────────────────────────────
context.env.PRIVATE_*          Server loader only       Never in browser
context.env.SESSION_SECRET     Server (context.ts)      Never in browser
context.env.PUBLIC_*           Server loader            Never in browser via context
import.meta.env.PUBLIC_*       Client components        Embedded in JS bundle by Vite
──────────────────────────────────────────────────────────────────────────────

Where secrets are stored
──────────────────────────────────────────────────────────────────────────────
Local dev        .env file (gitignored) → MiniOxygen reads it
Production       Oxygen dashboard → Cloudflare encrypted secret store → env param
──────────────────────────────────────────────────────────────────────────────
```
