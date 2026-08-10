# Hydrogen Learning Docs

> Production-grade reference for Shopify Hydrogen — built from official docs + this project's real code.

## Index

| Doc | What it covers |
|-----|----------------|
| [01-overview.md](./01-overview.md) | What Hydrogen is, the three-layer stack (Hydrogen + React Router + Oxygen) |
| [02-folder-structure.md](./02-folder-structure.md) | Every file and folder explained, production conventions |
| [03-routing.md](./03-routing.md) | File-based routing, dynamic routes, nested routes, locale prefixing |
| [04-server-side.md](./04-server-side.md) | server.ts, loaders, actions, SSR, streaming, deferred data |
| [05-graphql-storefront-api.md](./05-graphql-storefront-api.md) | How the Storefront API works, fragments, `@inContext`, codegen |
| [06-caching.md](./06-caching.md) | All cache strategies, edge caching, stale-while-revalidate, customer data safety |
| [07-third-party-integrations.md](./07-third-party-integrations.md) | CMS, analytics, REST/GraphQL APIs — patterns with caching |
| [08-analytics.md](./08-analytics.md) | Analytics.Provider, event types, GA4/Meta Pixel wiring |
| [09-production-best-practices.md](./09-production-best-practices.md) | Performance, security, env vars, error handling, pagination |
| [10-folder-best-practices.md](./10-folder-best-practices.md) | Folder & file conventions for a production storefront |
| [11-module-based-routing.md](./11-module-based-routing.md) | Module-based routing structure |
| [12-request-flow.md](./12-request-flow.md) | server.ts, context.ts, entry.server.tsx, entry.client.tsx |
| [13-security.md](./13-security.md) | Security best practices |
| [14-lazy-loading-and-streaming.md](./14-lazy-loading-and-streaming.md) | Above/below-fold splitting: deferred data streaming, `React.lazy`, image loading — with the `/lazy-demo` route |
| [15-cart-and-optimistic-ui.md](./15-cart-and-optimistic-ui.md) | Cart architecture, `CartForm` fetchers, `useOptimisticCart` internals, what's optimistic vs server-authoritative, custom optimistic price layer, revert path |

## Quick Reference

```
server.ts → createHydrogenRouterContext → createRequestHandler
route loader → context.storefront.query(QUERY, { cache: storefront.CacheLong() })
Analytics.Provider → useAnalytics().subscribe('page_viewed', ...)
```

## Official Sources

- [Hydrogen Fundamentals](https://shopify.dev/docs/storefronts/headless/hydrogen/fundamentals)
- [Storefront API Reference](https://shopify.dev/docs/api/storefront)
- [Caching Docs](https://shopify.dev/docs/storefronts/headless/hydrogen/caching)
- [Third-Party API Cookbook](https://shopify.dev/docs/storefronts/headless/hydrogen/cookbook/third-party-api)
- [Hydrogen GitHub](https://github.com/Shopify/hydrogen)
