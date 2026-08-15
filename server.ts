import * as serverBuild from 'virtual:react-router/server-build';
import {createRequestHandler, storefrontRedirect} from '@shopify/hydrogen';
import {createHydrogenRouterContext} from '~/lib/context';

export default {
  async fetch(
    request: Request,
    env: Env,
    executionContext: ExecutionContext,
  ): Promise<Response> {
    try {
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

      const oxygenCacheControl =
        response.headers.get('Oxygen-Cache-Control') ?? '';
      const isPublicPage = oxygenCacheControl.includes('public');

      if (hydrogenContext.session.isPending && !isPublicPage) {
        response.headers.set(
          'Set-Cookie',
          await hydrogenContext.session.commit(),
        );
      }

      if (isPublicPage) {
        // Hydrogen's storefront client always forwards Set-Cookie headers from
        // Storefront API subrequests into the Worker response via
        // setCollectedSubrequestHeaders() (collectTrackingInformation=true by default).
        // Oxygen exempts _shopify_y and _shopify_s but _shopify_essential is NOT on
        // that list — any Worker response that sets it is marked uncacheable.
        // Strip it here; Shopify's edge re-establishes it per user from request context.
        const allCookies = response.headers.getSetCookie();
        const withoutEssential = allCookies.filter(
          (c) => !c.startsWith('_shopify_essential='),
        );
        if (withoutEssential.length !== allCookies.length) {
          response.headers.delete('set-cookie');
          for (const cookie of withoutEssential) {
            response.headers.append('set-cookie', cookie);
          }
        }
      }

      if (response.status === 404) {
        return storefrontRedirect({
          request,
          response,
          storefront: hydrogenContext.storefront,
        });
      }

      return response;
    } catch (error) {
      console.error(error);
      return new Response('An unexpected error occurred', {status: 500});
    }
  },
};
