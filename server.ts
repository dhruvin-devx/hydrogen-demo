import * as serverBuild from 'virtual:react-router/server-build';
import {createRequestHandler, storefrontRedirect} from '@shopify/hydrogen';
import {createHydrogenRouterContext} from '~/lib/context';

const pageCache = await caches.open('hydrogen-pages');

export default {
  async fetch(
    request: Request,
    env: Env,
    executionContext: ExecutionContext,
  ): Promise<Response> {
    try {
      // Full-page cache: use URL-only cache key so the session cookie in the
      // request doesn't bypass the cache (Cloudflare skips cache for any
      // request that carries a Cookie header when using its default behaviour).
      const cacheKey = new Request(request.url);
      if (request.method === 'GET') {
        const cached = await pageCache.match(cacheKey);
        if (cached) return cached;
      }

      const hydrogenContext = await createHydrogenRouterContext(
        request,
        env,
        executionContext,
      );

      const handleRequest = createRequestHandler({
        build: serverBuild,
        mode: process.env.NODE_ENV,
        getLoadContext: () => hydrogenContext,
      });

      const response = await handleRequest(request);

      if (hydrogenContext.session.isPending) {
        response.headers.set(
          'Set-Cookie',
          await hydrogenContext.session.commit(),
        );
      }

      if (response.status === 404) {
        return storefrontRedirect({
          request,
          response,
          storefront: hydrogenContext.storefront,
        });
      }

      // Store in page cache only when safe: GET, no Set-Cookie (not personalized),
      // and the route opted into caching via Cache-Control max-age.
      if (
        request.method === 'GET' &&
        response.status === 200 &&
        !response.headers.has('Set-Cookie') &&
        response.headers.get('Cache-Control')?.includes('max-age')
      ) {
        executionContext.waitUntil(pageCache.put(cacheKey, response.clone()));
      }

      return response;
    } catch (error) {
      console.error(error);
      return new Response('An unexpected error occurred', {status: 500});
    }
  },
};
