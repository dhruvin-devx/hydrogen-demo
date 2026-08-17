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

      // if (isPublicPage) {
      //   // Hydrogen's storefront client forwards Set-Cookie headers from Storefront
      //   // API subrequests into the Worker response via setCollectedSubrequestHeaders()
      //   // (collectTrackingInformation=true by default). Any Set-Cookie makes Oxygen
      //   // mark the response uncacheable.
      //   //
      //   // These per-user Shopify cookies MUST be stripped on cached pages for two
      //   // reasons: (1) they trigger the uncacheable flag, and (2) a cached response is
      //   // shared byte-for-byte across all visitors, so baking one user's _shopify_y
      //   // visitor ID into the cached HTML would assign every visitor the SAME id and
      //   // poison analytics. Shopify's client-side Analytics.Provider regenerates these
      //   // per-browser (events go directly to monorail-edge.shopifysvc.com), so dropping
      //   // the server-set versions is correct, not just a workaround.
      //   const SHOPIFY_MANAGED_COOKIE_PREFIXES = [
      //     '_shopify_essential=',
      //     '_shopify_y=',
      //     '_shopify_s=',
      //     '_shopify_analytics=',
      //     '_shopify_marketing=',
      //   ];
      //   const allCookies = response.headers.getSetCookie();
      //   const keptCookies = allCookies.filter(
      //     (cookie) =>
      //       !SHOPIFY_MANAGED_COOKIE_PREFIXES.some((prefix) =>
      //         cookie.startsWith(prefix),
      //       ),
      //   );
      //   if (keptCookies.length !== allCookies.length) {
      //     response.headers.delete('set-cookie');
      //     for (const cookie of keptCookies) {
      //       response.headers.append('set-cookie', cookie);
      //     }
      //   }
      // }

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
