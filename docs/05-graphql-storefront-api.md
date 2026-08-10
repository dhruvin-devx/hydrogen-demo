# 05 — GraphQL & Storefront API

## What is the Storefront API?

The Shopify **Storefront API** is a public GraphQL endpoint that exposes your store's product catalog, collections, cart, customer accounts, and more. It is the backbone of every Hydrogen storefront.

- Endpoint: `https://{shop}.myshopify.com/api/{version}/graphql.json`
- Authenticated with a **Storefront API public access token** (safe to expose to browsers)
- In Hydrogen, you never call the raw endpoint — you use `context.storefront.query()`

## How Hydrogen Wraps GraphQL

`createHydrogenContext` creates a typed `storefront` client. In loaders:

```ts
const { product } = await context.storefront.query(PRODUCT_QUERY, {
  variables: { handle: params.handle },
  cache: context.storefront.CacheLong(),
});
```

Under the hood this:
1. Appends auth headers (`X-Shopify-Storefront-Access-Token`)
2. Injects `@inContext` variables (country, language) from the request locale
3. Checks the Oxygen edge cache — returns cached result if valid
4. If cache miss: fetches from Shopify, writes to cache, returns data

## Writing GraphQL Queries

Queries are defined as tagged template literals inside route files:

```ts
const PRODUCT_QUERY = `#graphql
  fragment ProductDetails on Product {
    id
    title
    handle
    description
    featuredImage {
      url
      altText
      width
      height
    }
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
    }
    variants(first: 100) {
      nodes {
        id
        title
        availableForSale
        selectedOptions {
          name
          value
        }
      }
    }
  }

  query Product(
    $handle: String!
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    product(handle: $handle) {
      ...ProductDetails
    }
  }
` as const;   // ← `as const` is required for codegen to work
```

### `#graphql` Tag

The `#graphql` comment prefix tells the Hydrogen codegen tool to generate TypeScript types for this query. The generated types are in `storefrontapi.generated.d.ts`.

### `@inContext` Directive

Tells Shopify to return localised prices, translations, and availability for the given market:

```graphql
query Product(
  $country: CountryCode        # e.g. US, GB, CA
  $language: LanguageCode      # e.g. EN, FR
) @inContext(country: $country, language: $language) {
  product(handle: "my-product") {
    title            # returned in the requested language
    priceRange {
      minVariantPrice {
        amount         # converted to the market's currency
        currencyCode   # USD, GBP, CAD
      }
    }
  }
}
```

Hydrogen automatically injects `country` and `language` from the request locale — you just declare the variables.

## GraphQL Fragments

Fragments let you define a set of fields once and reuse them across queries:

```ts
// app/lib/fragments.ts — shared fragments
export const MONEY_FRAGMENT = `#graphql
  fragment Money on MoneyV2 {
    amount
    currencyCode
  }
`;

export const PRODUCT_ITEM_FRAGMENT = `#graphql
  ${MONEY_FRAGMENT}
  fragment ProductItem on Product {
    id
    handle
    title
    featuredImage { id altText url width height }
    priceRange {
      minVariantPrice { ...Money }
      maxVariantPrice { ...Money }
    }
  }
`;
```

Use them in route queries:

```ts
import { PRODUCT_ITEM_FRAGMENT } from '~/lib/fragments';

const COLLECTION_QUERY = `#graphql
  ${PRODUCT_ITEM_FRAGMENT}
  query Collection($handle: String!) {
    collection(handle: $handle) {
      products(first: 8) {
        nodes { ...ProductItem }
      }
    }
  }
` as const;
```

## Pagination

The Storefront API uses cursor-based pagination (Relay-style):

```graphql
query Products(
  $first: Int
  $last: Int
  $startCursor: String
  $endCursor: String
) {
  products(first: $first, last: $last, before: $startCursor, after: $endCursor) {
    nodes {
      id
      title
    }
    pageInfo {
      hasPreviousPage
      hasNextPage
      startCursor
      endCursor
    }
  }
}
```

Hydrogen's `getPaginationVariables` reads the `?cursor=` and `?direction=` query params from the URL and returns the correct `first/last/startCursor/endCursor` variables:

```ts
const paginationVariables = getPaginationVariables(request, { pageBy: 8 });
const { collection } = await storefront.query(COLLECTION_QUERY, {
  variables: { handle, ...paginationVariables },
});
```

## TypeScript Codegen

Hydrogen generates TypeScript types from your `#graphql`-tagged queries automatically during `shopify hydrogen dev`.

Import generated types:

```ts
import type {
  ProductDetailsFragment,
  RecommendedProductsQuery,
} from 'storefrontapi.generated';

// Now your loader return types are fully typed
export async function loader(): Promise<{ product: ProductDetailsFragment }> { ... }
```

## Common Storefront API Queries

### Product by Handle

```graphql
query Product($handle: String!, $country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
  product(handle: $handle) {
    id title handle description
    featuredImage { url altText }
    variants(first: 250) {
      nodes {
        id title price { amount currencyCode }
        availableForSale
        selectedOptions { name value }
        image { url altText }
      }
    }
    media(first: 10) {
      nodes {
        ... on MediaImage {
          image { url altText width height }
        }
      }
    }
  }
}
```

### Collection with Products

```graphql
query Collection(
  $handle: String!
  $first: Int
  $last: Int
  $startCursor: String
  $endCursor: String
  $country: CountryCode
  $language: LanguageCode
) @inContext(country: $country, language: $language) {
  collection(handle: $handle) {
    id handle title description
    image { url altText }
    products(first: $first, last: $last, before: $startCursor, after: $endCursor) {
      nodes { id handle title priceRange { minVariantPrice { amount currencyCode } } }
      pageInfo { hasPreviousPage hasNextPage startCursor endCursor }
    }
  }
}
```

### Cart Operations

The cart is managed via Hydrogen's `context.cart` helper (not raw GraphQL):

```ts
// Add to cart
const result = await context.cart.addLines([
  { merchandiseId: variantId, quantity: 1 },
]);

// Get cart
const cart = await context.cart.get();

// Update quantity
await context.cart.updateLines([{ id: lineId, quantity: 2 }]);

// Remove line
await context.cart.removeLines([lineId]);
```

## Storefront API vs Admin API

| | Storefront API | Admin API |
|--|----------------|-----------|
| Auth token | Public (safe to expose) | Private (never expose) |
| Used in | Loaders, client-side fetches | Server-only (context.ts) |
| Data scope | Public catalog, cart, customer sessions | All store data, orders, fulfillments |
| Rate limits | More lenient | Stricter |
| Use case | Rendering product pages | Backend operations |

To use the Admin API in Hydrogen, add it to context but **never** return the token to the client.
