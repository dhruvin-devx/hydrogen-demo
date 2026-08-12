/**
 * /api/reviews — read-only resource route for fetching reviews lazily.
 *
 * GET /api/reviews?productId=<handle>
 *
 * Only a loader — no action. Writes go through the page's own action()
 * (e.g. /reviews-demo) so there is no public write endpoint at this URL.
 *
 * The API key is injected here server-side via context.env — it never
 * appears in any browser request.
 */

import type {LoaderFunctionArgs} from 'react-router';

export async function loader({request, context}: LoaderFunctionArgs) {
  const {REVIEW_API_URL = 'http://localhost:3001', REVIEW_API_KEY = ''} =
    context.env as Env;

  const url = new URL(request.url);
  const productId = url.searchParams.get('productId');

  if (!productId) {
    return Response.json({error: '`productId` is required'}, {status: 400});
  }

  try {
    const upstream = await fetch(
      `${REVIEW_API_URL}/api/reviews?productId=${encodeURIComponent(productId)}`,
      {headers: {'x-api-key': REVIEW_API_KEY}},
    );
    return Response.json(await upstream.json(), {status: upstream.status});
  } catch {
    return Response.json(
      {error: 'Review server is unreachable. Is it running on port 3001?'},
      {status: 503},
    );
  }
}
