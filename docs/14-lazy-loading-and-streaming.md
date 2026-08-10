# 14 — Lazy Loading & Streaming

Getting the above-the-fold content in front of the user as fast as possible, and paying for everything below the fold only when it's needed, is the core performance pattern in Hydrogen. Unlike a client-only SPA, Hydrogen is **SSR-streaming-first**, so "lazy loading" splits into three independent layers that you mix per page.

There is a runnable demo of all three in this project at **`/lazy-demo`** (`app/routes/system/lazy-demo.tsx`). This doc explains what it does and how to verify each layer.

## The Three Layers

```
                        ┌─────────────────────────────────────────────┐
                        │  ①  Critical data (awaited)                  │
   Above the fold  ───▶ │      → in the FIRST byte of HTML             │
                        │  Image loading="eager"  → LCP loads now      │
                        └─────────────────────────────────────────────┘
                        ┌─────────────────────────────────────────────┐
                        │  ②  Deferred data (NOT awaited)              │
   Below the fold  ───▶ │      → streamed after the shell             │
                        │      <Suspense> + <Await>                    │
                        ├─────────────────────────────────────────────┤
                        │  ③  Code-split components (React.lazy)       │
                        │      → JS chunk fetched on demand            │
                        │  Image loading="lazy"   → loads on scroll    │
                        └─────────────────────────────────────────────┘
```

| Layer | Splits… | Mechanism | Next.js analog |
|-------|---------|-----------|----------------|
| ① / ② Data streaming | **when data arrives** | `await` vs unawaited Promise + `Suspense`/`Await` | `loading.tsx` + streaming / `<Suspense>` |
| ③ Code splitting | **which JS ships** | `React.lazy(() => import())` | `next/dynamic` |
| Image loading | **when images fetch** | `<Image loading="eager"\|"lazy">` | `next/image` priority/lazy |

---

## Layer ① + ② — Data Streaming (the main pattern)

This is the closest analog to "above-fold eager, below-fold lazy." Instead of lazy-loading a *component*, you split the *data* in the loader. The server blocks on critical data only, streams the HTML shell immediately, then flushes deferred data as each Promise resolves.

### The loader convention

Hydrogen routes split loaders into two helpers (see `app/routes/home/index.tsx` for the canonical example):

```ts
export async function loader(args: Route.LoaderArgs) {
  const deferredData = loadDeferredData(args); // ← NO await (below the fold)
  const criticalData = await loadCriticalData(args); // ← await (above the fold)

  return data({...deferredData, ...criticalData});
}

// Blocking — the server waits for this before sending any HTML.
async function loadCriticalData({context}: Route.LoaderArgs) {
  const {collection} = await context.storefront.query(HERO_QUERY, {
    cache: context.storefront.CacheShort(),
  });
  return {hero: collection.nodes[0]};
}

// Non-blocking — returned as an UNRESOLVED Promise. React Router streams the
// shell first, then flushes this chunk to the browser when it resolves.
function loadDeferredData({context}: Route.LoaderArgs) {
  const deferredProducts = context.storefront
    .query(PRODUCTS_QUERY, {cache: context.storefront.CacheNone()})
    .catch((error) => {
      console.error(error);
      return null; // a rejected deferred promise would surface as an error boundary
    });
  return {deferredProducts};
}
```

> **Rule:** anything you `await` becomes part of the initial HTML (good for LCP + SEO). Anything you return as a Promise streams in later. Above-fold + SEO-critical content → await it. Below-fold → defer it.

### The component side — `Suspense` + `Await`

Deferred Promises are unwrapped on the client with React Router's `<Await>` inside a `<Suspense>` boundary. The `fallback` is your skeleton while the data streams:

```tsx
import {Await, useLoaderData} from 'react-router';
import {Suspense} from 'react';

export default function Page() {
  const {hero, deferredProducts} = useLoaderData<typeof loader>();

  return (
    <>
      {/* ① above the fold — already in the HTML */}
      <Hero data={hero} />

      {/* ② below the fold — streams in */}
      <Suspense fallback={<Skeleton />}>
        <Await resolve={deferredProducts}>
          {(res) => <ProductGrid products={res?.products?.nodes ?? []} />}
        </Await>
      </Suspense>
    </>
  );
}
```

### Why this beats a client fetch

```
Blocking everything (await all):   [───── wait for ALL data ─────] then paint
                                    slow FCP, slow LCP

Client fetch below fold:           paint shell → hydrate → useEffect → fetch → paint
                                    waterfall; below-fold data starts AFTER JS loads

Streaming (defer):                 paint shell (with above-fold) ──▶ stream below-fold
                                    fast FCP; below-fold data fetch STARTS on the server
```

Deferred queries start executing on the **server** the moment the request arrives — they just don't block the response. So the data is often already resolving by the time the browser finishes parsing the shell.

---

## Layer ③ — Code Splitting with `React.lazy`

Data streaming controls *when data arrives*; it does not reduce the JS bundle. To ship **less JavaScript** for heavy below-the-fold widgets (carousels, video players, review embeds, charting libs), use standard `React.lazy` + `Suspense`:

```tsx
import {lazy, Suspense} from 'react';

const HeavyReviews = lazy(() => import('~/components/HeavyReviews'));

<Suspense fallback={<Placeholder />}>
  <HeavyReviews />
</Suspense>;
```

The bundler emits `HeavyReviews` as its **own JS chunk**, excluded from the initial page bundle.

### Fetch the chunk only on scroll

`React.lazy` alone still requests the chunk during hydration. To defer the network request until the widget nears the viewport, gate the mount behind an `IntersectionObserver` (this is what `LazyOnVisible` does in `app/routes/system/lazy-demo.tsx`):

```tsx
function LazyOnVisible({children}: {children: React.ReactNode}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      {rootMargin: '200px'}, // start loading 200px before it enters view
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);

  return <div ref={ref}>{visible ? children : null}</div>;
}

// usage
<LazyOnVisible>
  <Suspense fallback={<Placeholder />}>
    <HeavyReviews />
  </Suspense>
</LazyOnVisible>;
```

> **Route-level splitting is automatic.** Every file under `app/routes/` is already its own chunk — React Router code-splits by route out of the box. Reach for `React.lazy` only for heavy components *within* a route.

> **SSR note.** A `React.lazy` component with no visibility gate is server-rendered normally. Once you gate it behind `IntersectionObserver` (client-only state), it becomes client-only — fine for non-SEO widgets like reviews, but don't hide SEO-critical content this way.

---

## Layer ③b — Image Loading

`<Image>` from `@shopify/hydrogen` takes a native `loading` attribute. Set the LCP/hero image to `eager`, everything below the fold to `lazy`:

```tsx
import {Image} from '@shopify/hydrogen';

<Image data={hero.image} loading="eager" sizes="100vw" />  {/* above fold / LCP */}
<Image data={product.featuredImage} loading="lazy" />       {/* below fold */}
```

`ProductItem` (`app/components/ProductItem.tsx`) already accepts a `loading` prop for exactly this — pass `"eager"` to the first row of a grid and `"lazy"` to the rest.

---

## The Demo Route — `/lazy-demo`

`app/routes/system/lazy-demo.tsx` exercises all three layers in one page, with deliberate instrumentation so each is observable:

| Section | Technique | Demo instrumentation |
|---------|-----------|----------------------|
| ① Hero | `await` + `Image loading="eager"` | Appears in raw HTML source |
| ② Recommended products | deferred query + `Suspense`/`Await` | **2.5s artificial delay** so the skeleton is visible |
| ③ Customer reviews | `React.lazy` + `IntersectionObserver` | Console log fires when the chunk executes |

Demo-only choices (do **not** copy into real routes):

- **2.5s `setTimeout`** wrapped around the deferred query — real code queries immediately.
- **`Cache-Control: no-store`** on the response — so the delay reproduces on every reload. Real routes should cache (see [06-caching.md](./06-caching.md)).
- **Tall 90vh spacers** — to force sections ② and ③ genuinely below the fold.

---

## How to Test

Run the dev server and open `http://localhost:3000/lazy-demo` with DevTools open.

```bash
npm run dev
```

### ① Above-fold in initial HTML — *View Source*

Right-click → **View Page Source** (raw SSR HTML, not the Elements inspector).

- ✅ The hero `<h1>` and image are present in the HTML.
- ✅ The products section shows the **skeleton** markup, not products — proving critical data shipped eagerly while deferred data had not yet resolved.

### ② Deferred data streaming — *the 2.5s test*

Hard reload (`Cmd/Ctrl+Shift+R`).

- ✅ The hero renders instantly.
- ✅ The products section shows "skeleton…" for ~2.5s, then products **pop in with no full-page navigation** — that is SSR streaming via `Suspense`/`Await`.
- In **Network → filter: Doc**, the `lazy-demo` document response stays open/streaming rather than completing all at once.

### ③ Code-split JS on scroll — *the chunk test*

Open **Network → filter: JS** and the **Console**.

- ✅ On load, no `HeavyReviews` chunk is present.
- ✅ Scroll toward section ③. As it nears the viewport (200px early via `rootMargin`), a new JS chunk downloads **and** the purple `[lazy-demo] HeavyReviews chunk downloaded + executed` log appears — proving the component was not in the initial bundle.

### Image eager vs lazy

In **Network → filter: Img**:

- ✅ The hero image request fires immediately on load.
- ✅ Product images fire only when scrolled into view (`loading="lazy"`).

---

## Applying It to Real Routes

| Route | Await (above fold) | Defer (below fold) |
|-------|--------------------|--------------------|
| `/` Home | featured collection, hero | recommended products *(already deferred)* |
| `/products/:handle` | product title, price, main image, add-to-cart | recommendations, reviews, recently-viewed |
| `/collections/:handle` | first row of products, collection header | remaining rows, filters facets |
| `/blogs/:handle/:article` | article body | related articles, comments |

**Checklist for a new route:**

1. Split the loader into `loadCriticalData` (await) and `loadDeferredData` (no await).
2. Keep SEO-critical + above-fold content in the awaited half.
3. Wrap each deferred Promise in `<Suspense fallback={<Skeleton/>}><Await>` on the component.
4. Always `.catch()` deferred queries so one failure degrades gracefully instead of throwing.
5. Set `loading="eager"` on the LCP image, `loading="lazy"` on the rest.
6. Use `React.lazy` only for genuinely heavy in-route widgets.
7. Cache the response — deferring is not a substitute for caching (see [06-caching.md](./06-caching.md)).

---

## Common Pitfalls

| Pitfall | Fix |
|---------|-----|
| `await`-ing everything | Only await above-fold/SEO content; defer the rest |
| Deferring above-fold content | Hurts LCP and SEO — the shell renders empty where content should be |
| No `.catch()` on a deferred query | A rejection bubbles to the error boundary instead of rendering `null` |
| `Response.json()` with deferred data | Serializes Promises to `null` — use `data()` from `react-router` to preserve them |
| Hiding SEO content behind `IntersectionObserver` | Crawlers won't see it — reserve visibility-gating for non-SEO widgets |
| Expecting `React.lazy` to speed up data | It only shrinks the JS bundle; use deferred data for data timing |

## Official Sources

- [Hydrogen — Deferring data with `defer`](https://shopify.dev/docs/storefronts/headless/hydrogen/data-fetching/defer)
- [React Router — Streaming with Suspense](https://reactrouter.com/how-to/suspense)
- [`<Image>` component](https://shopify.dev/docs/api/hydrogen/latest/components/image)
- [React — `lazy`](https://react.dev/reference/react/lazy)
