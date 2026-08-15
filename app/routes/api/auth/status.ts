import type {LoaderFunctionArgs} from 'react-router';

export async function loader({context}: LoaderFunctionArgs) {
  const isLoggedIn = await context.customerAccount.isLoggedIn();

  // If the user is not logged in but has a codeVerifier in their session, they
  // started an OAuth login flow but never completed it. This stale PKCE state
  // causes Shopify's CDN to update _shopify_essential on every request, which
  // makes Oxygen mark all pages as uncacheable. Clear it so future requests are
  // clean and the home page can be cached.
  if (!isLoggedIn) {
    const staleOAuth = context.session.get('customerAccount') as
      {codeVerifier?: string} | undefined;
    if (staleOAuth?.codeVerifier) {
      context.session.unset('customerAccount');
    }
  }

  return Response.json({isLoggedIn});
}
