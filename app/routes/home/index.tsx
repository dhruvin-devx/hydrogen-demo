import {Await, useLoaderData, Link, data} from 'react-router';
import type {Route} from './+types/index';
import {Suspense} from 'react';
import {
  Image,
  generateCacheControlHeader,
  CacheLong,
  CacheShort,
} from '@shopify/hydrogen';
import type {
  FeaturedCollectionFragment,
  RecommendedProductsQuery,
} from 'storefrontapi.generated';
import {ProductItem} from '~/components/ProductItem';
import {MockShopNotice} from '~/components/MockShopNotice';

export const meta: Route.MetaFunction = () => {
  return [{title: 'Hydrogen | Home'}];
};

export async function loader(args: Route.LoaderArgs) {
  const deferredData = loadDeferredData(args);
  const criticalData = await loadCriticalData(args);

  // Full-page cache: CDN caches the entire rendered HTML for 1 hour.
  // data() preserves deferred Promises (for <Await>) while still allowing
  // custom response headers — Response.json() would serialize Promises to null.
  return data(
    {...deferredData, ...criticalData},
    {headers: {'Cache-Control': generateCacheControlHeader(CacheLong())}},
  );
}

async function loadCriticalData({context}: Route.LoaderArgs) {
  const {storefront} = context;

  // Subrequest cache: Cloudflare Cache API stores this GraphQL response for
  // 1 hour. Subsequent requests hit the cache — no Shopify API call needed.
  const [{collections}] = await Promise.all([
    storefront.query(FEATURED_COLLECTION_QUERY, {
      cache: storefront.CacheLong(),
    }),
  ]);

  return {
    isShopLinked: Boolean(context.env.PUBLIC_STORE_DOMAIN),
    featuredCollection: collections.nodes[0],
    // Observability for full-page caching: this timestamp is baked into the
    // rendered HTML. On a full-page cache HIT the worker never runs, so the
    // value stays FROZEN across reloads. If it changes on every reload, the
    // worker re-rendered (a MISS / no edge cache, e.g. local dev).
    serverRenderedAt: new Date().toISOString(),
  };
}

function loadDeferredData({context}: Route.LoaderArgs) {
  const {storefront} = context;

  // No subrequest caching — every request fetches fresh products from the
  // Storefront API (no edge cache for this query).
  const recommendedProducts = storefront
    .query(RECOMMENDED_PRODUCTS_QUERY, {
      cache: storefront.CacheNone(),
    })
    .catch((error: Error) => {
      console.error(error);
      return null;
    });

  return {recommendedProducts};
}

export default function Homepage() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="home">
      {data.isShopLinked ? null : <MockShopNotice />}
      <p
        style={{
          fontSize: 12,
          color: '#888',
          fontFamily: 'monospace',
          margin: '0 0 1rem',
        }}
      >
        server-rendered at: {data.serverRenderedAt} — reload and watch this. If
        it stays frozen, the page came from the full-page cache; if it changes,
        the worker re-rendered.
      </p>
      <FeaturedCollection collection={data.featuredCollection} />
      <RecommendedProducts products={data.recommendedProducts} />
    </div>
  );
}

function FeaturedCollection({
  collection,
}: {
  collection: FeaturedCollectionFragment;
}) {
  if (!collection) return null;
  const image = collection?.image;
  return (
    <Link
      className="featured-collection"
      to={`/collections/${collection.handle}`}
    >
      {image && (
        <div className="featured-collection-image">
          <Image
            data={image}
            sizes="100vw"
            alt={image.altText || collection.title}
          />
        </div>
      )}
      <h1>{collection.title}</h1>
    </Link>
  );
}

function RecommendedProducts({
  products,
}: {
  products: Promise<RecommendedProductsQuery | null>;
}) {
  return (
    <section
      className="recommended-products"
      aria-labelledby="recommended-products"
    >
      <h1>Oziva stagging new feature Demo</h1>
      <h2 id="recommended-products">Recommended products</h2>
      <Suspense fallback={<div>Loading...</div>}>
        <Await resolve={products}>
          {(response) => (
            <div className="recommended-products-grid">
              {response
                ? response.products.nodes.map((product) => (
                    <ProductItem key={product.id} product={product} />
                  ))
                : null}
            </div>
          )}
        </Await>
      </Suspense>
      <br />
    </section>
  );
}

const FEATURED_COLLECTION_QUERY = `#graphql
  fragment FeaturedCollection on Collection {
    id
    title
    image {
      id
      url
      altText
      width
      height
    }
    handle
  }
  query FeaturedCollection($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    collections(first: 1, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ...FeaturedCollection
      }
    }
  }
` as const;

const RECOMMENDED_PRODUCTS_QUERY = `#graphql
  fragment RecommendedProduct on Product {
    id
    title
    handle
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
    }
    featuredImage {
      id
      url
      altText
      width
      height
    }
  }
  query RecommendedProducts ($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    products(first: 4, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ...RecommendedProduct
      }
    }
  }
` as const;
