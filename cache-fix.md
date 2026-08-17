# Oxygen Full-Page Cache Fix

How the home page was made publicly cacheable by Oxygen (Shopify's CDN), after
it was persistently returning `Oxygen-Full-Page-Cache: uncacheable`.

---

## TL;DR

Oxygen marks any Worker response that contains a `Set-Cookie` header as
**uncacheable**. Two independent sources were adding cookies to the home page
response:

1. **The app `session` cookie** — committed on every request when the session
   was mutated (`session.isPending = true`).
2. **Shopify's per-user cookies** (`_shopify_essential`, `_shopify_y`,
   `_shopify_s`, …) — forwarded automatically by Hydrogen from Storefront API
   subrequests into the Worker response.

The fix stops both from reaching the response **on pages that opt into public
caching**, while leaving cart / account / login pages completely untouched.

---

## Symptom

```
GET /
oxygen-cache-control:     public, max-age=3600, stale-while-revalidate=86400
oxygen-full-page-cache:   uncacheable          ← should be miss → hit
set-cookie:               _shopify_y=...
set-cookie:               _shopify_s=...
set-cookie:               _shopify_essential=...
```

A control route with **no Storefront API calls** (`/cache-test`) cached fine
(`miss` → `hit`), which isolated the cause to cookies produced by the data
fetching on the home page.

| Route | Storefront API calls | Cookies in response | Result |
|-------|----------------------|---------------------|--------|
| `/cache-test` | none | none | `miss` → `hit` ✅ |
| `/` (home) | 2× `storefront.query()` | `_shopify_essential`, `_shopify_y`, `_shopify_s` | `uncacheable` ❌ |

---

## Root Cause

### 1. Shopify cookies forwarded from subrequests

Every call to `storefront.query()` makes a subrequest to the Storefront API,
which **always** responds with `Set-Cookie: _shopify_essential=...` (plus the
`_shopify_y` / `_shopify_s` tracking cookies).

Hydrogen collects these and copies them onto the outgoing Worker response.
In `@shopify/hydrogen` source:

- `onRawHeaders` captures the subrequest's `Set-Cookie` list into
  `collectedSubrequestHeaders`.
- `setCollectedSubrequestHeaders(response)` appends each captured cookie onto
  the final response (`collectTrackingInformation = true` by default).

Result: even though the home loader touches no user data, the response still
carries per-user Shopify cookies → Oxygen sees `Set-Cookie` → `uncacheable`.

### 2. The app session cookie

`AppSession` sets `isPending = true` whenever anything calls `session.set()` /
`session.unset()`. `server.ts` then committed the session (adding
`Set-Cookie: session=...`) on **every** request where `isPending` was true —
including public pages.

---

## The Fixes

### Fix A — `server.ts` (primary)

On pages that declare `Oxygen-Cache-Control: public`:

1. **Do not commit the session** (no `Set-Cookie: session=...`).
2. **Strip Shopify's per-user cookies** from the response before returning.

On every other page (cart, account, login) behaviour is unchanged: the session
commits normally and all cookies pass through.

```ts
const response = await handleRequest(request);

const oxygenCacheControl = response.headers.get('Oxygen-Cache-Control') ?? '';
const isPublicPage = oxygenCacheControl.includes('public');

// 1. Only commit the session on pages that are NOT publicly cached.
if (hydrogenContext.session.isPending && !isPublicPage) {
  response.headers.set('Set-Cookie', await hydrogenContext.session.commit());
}

// 2. Strip Shopify per-user cookies on publicly cached pages.
if (isPublicPage) {
  const SHOPIFY_MANAGED_COOKIE_PREFIXES = [
    '_shopify_essential=',
    '_shopify_y=',
    '_shopify_s=',
    '_shopify_analytics=',
    '_shopify_marketing=',
  ];
  const allCookies = response.headers.getSetCookie();
  const keptCookies = allCookies.filter(
    (cookie) =>
      !SHOPIFY_MANAGED_COOKIE_PREFIXES.some((prefix) =>
        cookie.startsWith(prefix),
      ),
  );
  if (keptCookies.length !== allCookies.length) {
    response.headers.delete('set-cookie');
    for (const cookie of keptCookies) {
      response.headers.append('set-cookie', cookie);
    }
  }
}
```

**Why strip `_shopify_y` / `_shopify_s` and not just `_shopify_essential`?**
A cached response is served byte-for-byte to every visitor. If the server baked
one user's `_shopify_y` visitor ID into the cached HTML, **every** visitor would
receive that same ID — poisoning analytics far worse than dropping it. Shopify's
client-side `Analytics.Provider` regenerates these per-browser (events go
straight to `monorail-edge.shopifysvc.com`), so removing the server-set copies
on cached pages is correct, not merely a workaround.

### Fix B — `app/lib/session.ts` (supporting)

`AppSession` was flipping `isPending = true` on property **access**, because the
`get set()` / `get unset()` getters ran the side effect when Hydrogen's
customer-account client destructured them — even if `set()` was never called.

The wrappers are now pre-created in the constructor, so `isPending` only becomes
true when `set()` / `unset()` is actually **invoked**:

```ts
constructor(sessionStorage, session) {
  this.#setFn = (...args) => { this.isPending = true; return session.set(...args); };
  this.#unsetFn = (...args) => { this.isPending = true; return session.unset(...args); };
}
get set()   { return this.#setFn; }
get unset() { return this.#unsetFn; }
```

### Fix C — Client-side cart & auth (supporting, done earlier)

To keep user-specific data out of the cached HTML entirely:

- **Cart** is loaded client-side via `CartProvider` → `fetch('/api/cart')`,
  instead of `cart.get()` in the root loader.
- **Auth status** (Sign in / Account label) is loaded client-side via
  `useFetcher('/api/auth/status')` in the header.
- `Analytics.Provider` receives a stable `Promise.resolve(null)` cart instead of
  a streamed server cart.

---

## Requirements for a route to be cacheable

For any route you want Oxygen to full-page cache:

1. **Export a `headers()` function** that sets `Oxygen-Cache-Control: public`:
   ```ts
   export function headers() {
     return {
       'Oxygen-Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
       Vary: 'Accept-Encoding',
     };
   }
   ```
   This header is the signal `server.ts` uses to decide whether to strip cookies
   and skip the session commit.

2. **No user-specific server data in the loader.** No `cart.get()`, no
   `customerAccount.isLoggedIn()`, no `session.set()`/`unset()` on that request.
   Anything user-specific must be loaded client-side (see Fix C).

3. **Storefront API calls are fine** — the cookies they produce are stripped by
   `server.ts`. Use `CacheLong()` / `CacheNone()` on queries as appropriate.

---

## Files Changed

| File | Change |
|------|--------|
| `server.ts` | Skip session commit + strip Shopify cookies on public pages |
| `app/lib/session.ts` | `isPending` only set when `set`/`unset` is called, not on access |
| `app/root.tsx` | No `cart.get()` in loader; `NULL_CART` for Analytics; wrapped in `CartProvider` |
| `app/components/PageLayout.tsx` | Cart read from `useCart()` context instead of props |
| `app/components/Header.tsx` | Auth status + cart read client-side |
| `app/components/CartProvider.tsx` | New — client-side cart fetch from `/api/cart` |
| `app/routes/api/cart.ts` | New — returns `cart.get()` as JSON |
| `app/routes/api/auth/status.ts` | New — returns `{isLoggedIn}`; clears stale PKCE state |
| `app/routes/home/index.tsx` | `headers()` exports `Oxygen-Cache-Control: public` |

---

## How to Verify

1. Deploy (push to `uat` → GitHub Actions → `npx shopify hydrogen deploy`).
2. Open the home page in DevTools → Network → the document request → Headers.
3. Check the response:
   - `oxygen-full-page-cache: miss` on the first request.
   - `oxygen-full-page-cache: hit` on subsequent requests.
   - No `_shopify_*` cookies and no `session=...` in the response `Set-Cookie`.
4. Confirm cart, sign-in, and account pages still work (they set cookies and
   remain `uncacheable`, which is correct).

---

## Notes / Caveats

- Stripping cookies is scoped **only** to routes with `Oxygen-Cache-Control:
  public`. Cart, account, login, and any dynamic route are unaffected.
- Analytics still work: Shopify's client-side analytics library sets its own
  `_shopify_y` / `_shopify_s` in the browser and posts events directly to
  `monorail-edge.shopifysvc.com` (already allowed by the CSP `connect-src`).
- Checkout runs on a separate Shopify-hosted domain and is not touched by this.
- This is a Worker-level response transform, not an official Shopify toggle —
  keep it in mind when upgrading `@shopify/hydrogen` in case the internal
  cookie-forwarding behaviour changes.
