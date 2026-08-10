import {Await, useLoaderData, data} from 'react-router';
import {Suspense, lazy} from 'react';
import {Image, Money} from '@shopify/hydrogen';
import type {Route} from './+types/lazy-demo';
import type {ProductItemFragment} from 'storefrontapi.generated';
// import HeavyReviews from '~/components/HeavyReviews';
export const meta: Route.MetaFunction = () => {
  return [{title: 'Hydrogen | Lazy-loading demo'}];
};

// ───────────────────────── LOADER ─────────────────────────
// The loader splits data into two buckets:
//   • criticalData  → awaited  → in the initial HTML (above the fold)
//   • deferredData  → NOT awaited → streamed in later (below the fold)
export async function loader(args: Route.LoaderArgs) {
  const deferredData = loadDeferredData(args); // no await
  const criticalData = await loadCriticalData(args); // await

  return data(
    {...deferredData, ...criticalData},
    // no-store so the artificial delay is observable on every reload.
    // (In real code you'd cache this — see routes/home/index.tsx.)
    {headers: {'Cache-Control': 'no-store'}},
  );
}

// ABOVE THE FOLD — blocking. Server waits for this before sending any HTML.
async function loadCriticalData({context}: Route.LoaderArgs) {
  const {storefront} = context;
  const {collection} = await storefront.query(HERO_COLLECTION_QUERY, {
    cache: storefront.CacheShort(),
  });
  return {hero: collection.nodes[0]};
}

// BELOW THE FOLD — non-blocking. Returned as an unresolved Promise so React
// Router streams the page shell first, then flushes this chunk when it resolves.
// The 2.5s delay is DEMO-ONLY, to make the streaming boundary visible.
function loadDeferredData({context}: Route.LoaderArgs) {
  const {storefront} = context;

  const deferredProducts = new Promise((resolve) => setTimeout(resolve, 2500))
    .then(() =>
      storefront.query(DEFERRED_PRODUCTS_QUERY, {
        cache: storefront.CacheNone(),
      }),
    )
    .catch((error: Error) => {
      // eslint-disable-next-line no-console
      console.error(error);
      return null;
    });

  return {deferredProducts};
}

// ───────────────────── CODE-SPLIT WIDGET ─────────────────────
// React.lazy makes HeavyReviews its own JS chunk (not in the initial bundle).
// This is the native equivalent of Next.js `next/dynamic`.
const HeavyReviews = lazy(() => import('~/components/HeavyReviews'));

// ───────────────────────── PAGE ─────────────────────────
export default function LazyDemo() {
  const {hero, deferredProducts} = useLoaderData<typeof loader>();

  return (
    <div style={{maxWidth: 900, margin: '0 auto', padding: '1rem'}}>
      {/* ①  ABOVE THE FOLD — critical data, eager image, in initial HTML */}
      <section>
        <span style={badge('#0a7d33')}>① Above the fold · awaited · eager</span>
        <h1>Lazy-loading demo</h1>
        {hero?.image ? (
          <Image
            data={hero.image}
            loading="eager" /* LCP image — load immediately */
            sizes="(min-width: 900px) 900px, 100vw"
            aspectRatio="16/9"
          />
        ) : (
          <div style={placeholder(300)}>hero image (no store data)</div>
        )}
        <p>
          This section is rendered on the server and arrives in the very first
          byte of HTML. The hero image uses{' '}
          <code>loading=&quot;eager&quot;</code>.
        </p>
      </section>

      {/* Tall spacer so the sections below are genuinely below the fold */}
      <Spacer label="scroll down ↓" />

      {/* ②  STREAMED DATA — deferred query behind Suspense + Await */}
      <section>
        <span style={badge('#b8860b')}>
          ② Deferred data · streamed · Suspense/Await
        </span>
        <h2>Recommended products (streamed after 2.5s)</h2>
        <Suspense fallback={<StreamingSkeleton />}>
          <Await resolve={deferredProducts}>
            {(res: any) => (
              <div
                style={{
                  display: 'grid',
                  gap: '1rem',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                }}
              >
                {res?.products?.nodes?.map((p: ProductItemFragment) => (
                  <div key={p.id}>
                    {p.featuredImage && (
                      <Image
                        data={p.featuredImage}
                        loading="lazy" /* below fold → lazy */
                        aspectRatio="1/1"
                        sizes="180px"
                      />
                    )}
                    <strong>{p.title}</strong>
                    <br />
                    <Money data={p.priceRange.minVariantPrice} />
                  </div>
                )) ?? <p>No products found.</p>}
              </div>
            )}
          </Await>
        </Suspense>
      </section>

      <Spacer label="keep scrolling ↓" />

      {/* ③  CODE-SPLIT JS — HeavyReviews ships as its own chunk (React.lazy) */}
      <section>
        <span style={badge('#7b3fe4')}>
          ③ Code-split component · React.lazy
        </span>
        <h2>Customer reviews (heavy widget)</h2>
        <p>
          Open DevTools → Network (filter: JS) and Console. The{' '}
          <code>HeavyReviews</code> component ships as its own JS chunk (not in
          the initial bundle), loaded on demand — the native equivalent of{' '}
          <code>next/dynamic</code>.
        </p>
        <Suspense
          fallback={<div style={placeholder(120)}>loading widget…</div>}
        >
          <HeavyReviews />
        </Suspense>
      </section>
    </div>
  );
}

// ───────────────────────── UI helpers ─────────────────────────
function Spacer({label}: {label: string}) {
  return (
    <div
      style={{
        height: '90vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#999',
        border: '2px dashed #ddd',
        margin: '1rem 0',
      }}
    >
      {label}
    </div>
  );
}

function StreamingSkeleton() {
  return (
    <div
      style={{
        display: 'grid',
        gap: '1rem',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
      }}
    >
      {Array.from({length: 4}).map((_, i) => (
        <div key={i} style={placeholder(220)}>
          skeleton…
        </div>
      ))}
    </div>
  );
}

const badge = (bg: string): React.CSSProperties => ({
  display: 'inline-block',
  background: bg,
  color: '#fff',
  fontSize: 12,
  padding: '2px 8px',
  borderRadius: 4,
  marginBottom: 8,
});

const placeholder = (h: number): React.CSSProperties => ({
  height: h,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f3f3f3',
  color: '#aaa',
  borderRadius: 6,
});

// ───────────────────────── GraphQL ─────────────────────────
const HERO_COLLECTION_QUERY = `#graphql
  query LazyDemoHero($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    collection: collections(first: 1, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        image { id url altText width height }
      }
    }
  }
` as const;

const DEFERRED_PRODUCTS_QUERY = `#graphql
  query LazyDemoProducts($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    products(first: 8, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        priceRange { minVariantPrice { amount currencyCode } }
        featuredImage { id url altText width height }
      }
    }
  }
` as const;
