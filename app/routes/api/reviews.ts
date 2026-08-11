/**
 * /api/reviews — server-side proxy for the third-party Review API.
 *
 * The browser (fetcher) calls THIS route, never the standalone server.
 * The API key is read from context.env (Workers runtime) and injected here,
 * server-side — it is never visible in the browser's Network tab.
 */

import type {LoaderFunctionArgs, ActionFunctionArgs} from 'react-router';

// ── GET /api/reviews?productId=<handle> ───────────────────────────────────────
export async function loader({request, context}: LoaderFunctionArgs) {
  // context.env is the correct way to read env vars in Hydrogen's Workers runtime.
  // process.env does NOT exist in mini-oxygen — using it silently returns undefined.
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
    const data = await upstream.json();
    return Response.json(data, {status: upstream.status});
  } catch {
    return Response.json(
      {error: 'Review server is unreachable. Is it running on port 3001?'},
      {status: 503},
    );
  }
}

// ── POST /api/reviews ─────────────────────────────────────────────────────────
export async function action({request, context}: ActionFunctionArgs) {
  const {REVIEW_API_URL = 'http://localhost:3001', REVIEW_API_KEY = ''} =
    context.env as Env;

  let body: Record<string, unknown>;

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    body = (await request.json()) as Record<string, unknown>;
  } else {
    // formData fallback (useFetcher / <Form> default encoding)
    const fd = await request.formData();
    body = Object.fromEntries(fd.entries());
    if (body.rating !== undefined) body.rating = Number(body.rating);
  }

  try {
    const upstream = await fetch(`${REVIEW_API_URL}/api/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': REVIEW_API_KEY, // injected server-side — never reaches the browser
      },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();
    return Response.json(data, {status: upstream.status});
  } catch {
    return Response.json(
      {error: 'Review server is unreachable. Is it running on port 3001?'},
      {status: 503},
    );
  }
}
