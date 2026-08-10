# 08 — Analytics

## Architecture

Hydrogen's analytics system has two layers:

1. **`Analytics.Provider`** — wraps the app, collects events, sends to Shopify
2. **Subscribe API** — lets you tap into those events and forward them to third-party platforms

```
User Action (page view, add to cart)
        │
        ▼
Analytics.Provider (publishes events internally)
        │
        ├─ Shopify Pixel / Customer Privacy API (built-in)
        │
        └─ Your custom subscriber components:
             ├─ Google Analytics 4
             ├─ Meta Pixel
             └─ any other platform
```

## Setting Up `Analytics.Provider`

Wrap your app in `root.tsx`:

```tsx
// app/root.tsx
import { Analytics } from '@shopify/hydrogen';

export async function loader({ context }: Route.LoaderArgs) {
  const [cart, shop, consent] = await Promise.all([
    context.cart.get(),
    context.storefront.query(SHOP_ANALYTICS_QUERY, { cache: context.storefront.CacheLong() }),
    context.customerPrivacy.getConsent(),    // consent must be set up
  ]);
  return { cart, shop: shop.shop, consent };
}

export default function App() {
  const { cart, shop, consent } = useLoaderData<typeof loader>();

  return (
    <Analytics.Provider cart={cart} shop={shop} consent={consent}>
      <PageLayout>
        <Outlet />
      </PageLayout>
      <GoogleAnalytics />          {/* ← custom subscriber, must be inside Provider */}
      <MetaPixel />
    </Analytics.Provider>
  );
}

const SHOP_ANALYTICS_QUERY = `#graphql
  query ShopAnalytics { shop { id name } }
`;
```

## Route-Level Analytics Events

Add the appropriate component inside your route's JSX:

```tsx
// Product page
import { Analytics } from '@shopify/hydrogen';

export default function ProductPage() {
  const { product } = useLoaderData<typeof loader>();
  return (
    <>
      <ProductDetails product={product} />
      <Analytics.ProductView
        data={{
          products: [{
            id: product.id,
            title: product.title,
            price: product.priceRange.minVariantPrice.amount,
            variantId: product.variants.nodes[0]?.id ?? '',
            variantTitle: product.variants.nodes[0]?.title ?? '',
            vendor: product.vendor,
            quantity: 1,
          }],
        }}
      />
    </>
  );
}
```

| Route | Component | Required Props |
|-------|-----------|---------------|
| Product page | `<Analytics.ProductView>` | `products[]` (id, price, variantId, quantity) |
| Collection page | `<Analytics.CollectionView>` | `collection` (id, handle) |
| Search page | `<Analytics.SearchView>` | `searchTerm`, `searchResults` |
| Cart page | `<Analytics.CartView>` | none |
| Cart drawer (custom) | `useAnalytics().publish('cart_viewed', {...})` | cart object |

```tsx
// Collection page
<Analytics.CollectionView
  data={{ collection: { id: collection.id, handle: collection.handle } }}
/>

// Search page
<Analytics.SearchView
  data={{ searchTerm: term, searchResults: results }}
/>
```

## Writing a Custom Analytics Subscriber

Create a component that uses `useAnalytics()`. It must be rendered **inside** `Analytics.Provider`.

```tsx
// app/components/analytics/GoogleAnalytics.tsx
import { useAnalytics } from '@shopify/hydrogen';
import { useEffect } from 'react';

declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
    dataLayer: unknown[];
  }
}

export function GoogleAnalytics({ measurementId }: { measurementId: string }) {
  const { subscribe, register } = useAnalytics();
  const { ready } = register('Google Analytics 4');

  useEffect(() => {
    // Load the GA4 script
    const script = document.createElement('script');
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    script.async = true;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function (...args) { window.dataLayer.push(args); };
    window.gtag('js', new Date());
    window.gtag('config', measurementId);

    // Subscribe to Hydrogen events and forward to GA4
    subscribe('page_viewed', (data) => {
      window.gtag('event', 'page_view', {
        page_location: data.url,
        page_title: document.title,
      });
    });

    subscribe('product_viewed', (data) => {
      window.gtag('event', 'view_item', {
        items: data.products.map((p) => ({
          item_id: p.id,
          item_name: p.title,
          price: p.price,
        })),
      });
    });

    subscribe('cart_updated', (data) => {
      const addedItems = data.cart?.lines?.nodes ?? [];
      window.gtag('event', 'add_to_cart', {
        items: addedItems.map((line) => ({
          item_id: line.merchandise.product.id,
          item_name: line.merchandise.product.title,
          quantity: line.quantity,
        })),
      });
    });

    ready();   // ← must be called after all subscriptions are registered
  }, []);

  return null;
}
```

## Meta Pixel Subscriber

```tsx
// app/components/analytics/MetaPixel.tsx
import { useAnalytics } from '@shopify/hydrogen';
import { useEffect } from 'react';

export function MetaPixel({ pixelId }: { pixelId: string }) {
  const { subscribe, register } = useAnalytics();
  const { ready } = register('Meta Pixel');

  useEffect(() => {
    // Load fbq
    (function(f: Window, b: Document, e: string, v: string) {
      const n = f.fbq = function(...args: unknown[]) { n.callMethod ? n.callMethod(...args) : n.queue.push(args); };
      n.queue = [];
      const t = b.createElement(e) as HTMLScriptElement;
      t.async = true; t.src = v;
      b.head.appendChild(t);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    window.fbq('init', pixelId);

    subscribe('page_viewed', () => { window.fbq('track', 'PageView'); });
    subscribe('product_viewed', (data) => {
      window.fbq('track', 'ViewContent', {
        content_ids: data.products.map((p) => p.id),
        content_type: 'product',
      });
    });
    subscribe('cart_updated', (data) => {
      window.fbq('track', 'AddToCart', {
        content_ids: data.cart?.lines?.nodes?.map((l) => l.merchandise.product.id) ?? [],
      });
    });

    ready();
  }, []);

  return null;
}
```

## Subscribable Events

| Event | Payload |
|-------|---------|
| `page_viewed` | `{ url, shop, currency, ... }` |
| `product_viewed` | `{ products[], shop, url }` |
| `collection_viewed` | `{ collection, shop, url }` |
| `cart_viewed` | `{ cart, shop, url }` |
| `cart_updated` | `{ cart, prevCart, shop, url }` |
| `search_viewed` | `{ searchTerm, searchResults, shop, url }` |

Custom events:

```ts
const { publish } = useAnalytics();
publish('custom_wishlist_added', { productId: '123', userId: user.id });

// In subscriber:
subscribe('custom_wishlist_added', (data) => {
  // send to your platform
});
```

## Consent Management

Analytics events **will not fire** unless consent is configured:

```ts
// In root.tsx loader
const consent = await context.customerPrivacy.getConsent();
// Pass to Analytics.Provider
<Analytics.Provider consent={consent}>
```

For GDPR regions, Shopify's Customer Privacy API handles the cookie banner automatically when connected.

If using a third-party CMP (Consent Management Platform):

```tsx
import { useAnalytics } from '@shopify/hydrogen';

function ThirdPartyCMP() {
  const { canTrack } = useAnalytics();
  // canTrack() returns true only after user consent is given
  const hasConsent = canTrack();
  // ...
}
```

## Key Rules

1. All subscriber components must be **inside** `<Analytics.Provider>`
2. Call `ready()` after all `subscribe()` calls — this signals the provider to start firing events
3. Never subscribe in the component body — always inside `useEffect`
4. `cart` query in `root.tsx` **must** include the `updatedAt` field for `cart_updated` events to fire
5. Customer Account API data is **never** tracked by the analytics system (personalised)
