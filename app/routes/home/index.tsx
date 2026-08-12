import {useLoaderData, Link, data} from 'react-router';
import type {Route} from './+types/index';
import {Image, generateCacheControlHeader, CacheLong} from '@shopify/hydrogen';
import type {
  FeaturedCollectionFragment,
  RecommendedProductsQuery,
} from 'storefrontapi.generated';
import {ProductItem} from '~/components/ProductItem';
import {MockShopNotice} from '~/components/MockShopNotice';

export const meta: Route.MetaFunction = () => {
  return [{title: 'Hydrogen | Home'}];
};

export function headers() {
  return {
    'Oxygen-Cache-Control':
      'public, max-age=3600, stale-while-revalidate=86400',
    Vary: 'Accept-Encoding',
  };
}

export async function loader(args: Route.LoaderArgs) {
  const criticalData = await loadCriticalData(args);
  return data(criticalData);
}

async function loadCriticalData({context}: Route.LoaderArgs) {
  const {storefront} = context;

  const [{collections}, {products}] = await Promise.all([
    storefront.query(FEATURED_COLLECTION_QUERY, {
      cache: storefront.CacheLong(),
    }),
    // CacheNone: fetch fresh products on every page cache miss, no subrequest cache.
    storefront.query(RECOMMENDED_PRODUCTS_QUERY, {
      cache: storefront.CacheNone(),
    }),
  ]);

  return {
    isShopLinked: Boolean(context.env.PUBLIC_STORE_DOMAIN),
    featuredCollection: collections.nodes[0],
    recommendedProducts: products,
    serverRenderedAt: new Date().toISOString(),
  };
}

export default function Homepage() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="home">
      {data.isShopLinked ? null : <MockShopNotice />}
      <h1>Oziva demo UAT</h1>
      <FeaturedCollection collection={data.featuredCollection} />
      {data.recommendedProducts && (
        <RecommendedProducts products={data.recommendedProducts} />
      )}
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
  products: RecommendedProductsQuery['products'];
}) {
  return (
    <section
      className="recommended-products"
      aria-labelledby="recommended-products"
    >
      <h2 id="recommended-products">Recommended products</h2>
      <div className="recommended-products-grid">
        {products.nodes.map((product) => (
          <ProductItem key={product.id} product={product} />
        ))}
      </div>
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
