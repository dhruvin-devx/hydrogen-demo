# 01 — Hydrogen Overview

## What is Hydrogen?

Hydrogen is Shopify's open-source React framework for building **custom headless storefronts**. It is not a theme — it is a full application framework that gives you complete control over the frontend while Shopify handles the commerce backend.

## The Three-Layer Stack

```
┌──────────────────────────────────────────┐
│               Your Code                  │
│   (routes, components, lib, styles)      │
├──────────────────────────────────────────┤
│             @shopify/hydrogen            │
│  Storefront API client, cart utils,      │
│  caching helpers, Analytics, Image       │
├──────────────────────────────────────────┤
│             React Router v7              │
│  File-based routing, SSR, loaders,       │
│  actions, streaming, nested routes       │
├──────────────────────────────────────────┤
│               Oxygen                     │
│  Shopify's V8 Isolate edge runtime       │
│  (free hosting on paid plans)            │
└──────────────────────────────────────────┘
```

### Hydrogen (`@shopify/hydrogen`)
- Typed Storefront API client (`context.storefront.query`)
- Cart utilities (`createCartHandler`)
- Caching strategies (`CacheLong`, `CacheShort`, `CacheNone`, `CacheCustom`)
- Analytics provider + event system
- Hydrogen-specific components: `<Image>`, `<Money>`, `<Pagination>`
- `createHydrogenContext` — wires all of the above together

### React Router v7
- Routing and SSR engine (Shopify migrated from Remix to RR v7 in 2025)
- `loader()` — server-side data fetching per route
- `action()` — server-side form/mutation handler
- `defer()` / `<Await>` — streaming deferred data
- `<Outlet>` — nested layouts

### Oxygen
- Cloudflare `workerd`-based V8 isolate runtime
- Deployed at the edge globally
- Exposes standard Web APIs: `fetch`, `Cache`, `Streams`, `WebCrypto`
- Worker limits: ≤10 MB bundle, ≤400 ms startup, ≤30 s CPU/request, ≤128 MB RAM
- Free on paid Shopify plans; self-hosting supported for Node.js / Express

## How a Request Flows

```
Browser Request
     │
     ▼
Oxygen Edge Worker
     │  server.ts: createHydrogenRouterContext
     │  - opens cache store
     │  - initialises session
     │  - creates storefront client
     ▼
React Router createRequestHandler
     │  matches route file
     │  runs loader()
     │    └─ context.storefront.query(GRAPHQL, { cache: CacheLong() })
     │         └─ hits Shopify Storefront API (same datacenter → fast)
     │         └─ writes response to edge cache
     ▼
Streaming SSR (HTML chunks sent immediately)
     │  above-the-fold HTML → browser
     │  deferred data resolves → more chunks
     ▼
Browser Hydration (React takes over, client-side nav)
```

## Key Packages

| Package | Role |
|---------|------|
| `@shopify/hydrogen` | Core framework utilities |
| `@shopify/mini-oxygen` | Local dev runtime (mirrors Oxygen) |
| `@shopify/hydrogen-codegen` | Generates TypeScript types from your GraphQL queries |
| `@shopify/cli` | `shopify hydrogen dev`, `deploy`, `generate` CLI |
| `react-router` | Routing + SSR engine |
| `@react-router/dev` | Vite plugin for React Router |

## When to Use Hydrogen vs Liquid

| Scenario | Choice |
|----------|--------|
| Custom design, full control | Hydrogen |
| Content-heavy, team with no React expertise | Liquid |
| Multi-channel (web + mobile + kiosk) | Hydrogen (API-first) |
| Fast time-to-market, simple store | Liquid |
| Need a headless CMS (Sanity, Contentful) | Hydrogen |
