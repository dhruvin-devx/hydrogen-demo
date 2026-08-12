import {type RouteConfig, route, layout, index} from '@react-router/dev/routes';
import {hydrogenRoutes} from '@shopify/hydrogen';

export default hydrogenRoutes([
  // API proxy route — outside the locale wrapper (no locale prefix needed)
  route('api/reviews', 'routes/api/reviews.ts'),

  // Locale layout — optional /:locale? prefix wraps everything
  route(':locale?', 'routes/($locale).tsx', [
    // HOME
    index('routes/home/index.tsx'),

    // DEMO — lazy-loading / streaming demonstration
    route('lazy-demo', 'routes/system/lazy-demo.tsx'),

    // DEMO — third-party API / credential isolation demonstration
    route('reviews-demo', 'routes/reviews-demo/index.tsx'),

    // DEMO — Shopify Admin API credential isolation demonstration
    route('admin-demo', 'routes/admin-demo/index.tsx'),

    // CATALOG
    route('products/:handle', 'routes/catalog/products/$handle.tsx'),
    route('collections', 'routes/catalog/collections/index.tsx'),
    route('collections/all', 'routes/catalog/collections/all.tsx'),
    route('collections/:handle', 'routes/catalog/collections/$handle.tsx'),
    route('search', 'routes/catalog/search.tsx'),

    // CART
    route('cart', 'routes/cart/index.tsx'),
    route('cart/:lines', 'routes/cart/$lines.tsx'),
    route('discount/:code', 'routes/system/discount.tsx'),

    // ACCOUNT — authenticated routes nested under account layout
    layout('routes/account/layout.tsx', [
      route('account', 'routes/account/index.tsx'),
      route('account/profile', 'routes/account/profile.tsx'),
      route('account/addresses', 'routes/account/addresses.tsx'),
      route('account/orders', 'routes/account/orders/index.tsx'),
      route('account/orders/:id', 'routes/account/orders/$id.tsx'),
      route('account/*', 'routes/account/$.tsx'),
    ]),

    // AUTH — outside account layout (no auth guard)
    route('account/login', 'routes/auth/login.tsx'),
    route('account/logout', 'routes/auth/logout.tsx'),
    route('account/authorize', 'routes/auth/authorize.tsx'),

    // CONTENT
    route('blogs', 'routes/content/blogs/index.tsx'),
    route('blogs/:blogHandle', 'routes/content/blogs/$blogHandle/index.tsx'),
    route(
      'blogs/:blogHandle/:articleHandle',
      'routes/content/blogs/$blogHandle/$articleHandle.tsx',
    ),
    route('pages/:handle', 'routes/content/pages/$handle.tsx'),
    route('policies', 'routes/content/policies/index.tsx'),
    route('policies/:handle', 'routes/content/policies/$handle.tsx'),

    // SYSTEM
    route('cache-test', 'routes/system/cache-test.tsx'),
    route('sitemap.xml', 'routes/system/sitemap-index.tsx'),
    route('sitemap/:type/:page.xml', 'routes/system/sitemap.tsx'),

    // CATCH-ALL 404
    route('*', 'routes/($locale).$.tsx'),
  ]),

  // Outside locale wrapper
  route('robots.txt', 'routes/[robots.txt].tsx'),
]) satisfies RouteConfig;
