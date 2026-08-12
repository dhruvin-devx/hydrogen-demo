/**
 * /reviews-demo — demonstrates the correct Hydrogen pattern for calling a
 * third-party API without exposing credentials in the browser.
 *
 * Core insight: loader() and action() ALWAYS run on the server in Hydrogen.
 * The API key lives only in context.env — it is never serialised into any
 * browser request, regardless of how the route is triggered.
 *
 * Pattern 1 — loader + <Form>
 *   - Reviews fetched server-side before the page renders (SSR)
 *   - Form POST triggers action() on the server — no proxy needed
 *
 * Pattern 2 — useFetcher targeting the same page action
 *   - Reviews loaded lazily with useFetcher.load('/api/reviews')
 *   - Submission uses useFetcher.Form action="/reviews-demo" — still calls
 *     THIS file's action() on the server. No separate proxy route needed.
 *
 * The key: useFetcher can target any route's action. The action always runs
 * server-side, so the API key is safe by definition.
 */

import {useLoaderData, useFetcher, Form, useActionData, data} from 'react-router';
import type {LoaderFunctionArgs, ActionFunctionArgs} from 'react-router';
import {useState, useEffect} from 'react';

// ─── IP rate limiter ──────────────────────────────────────────────────────────
// Module-level Map persists for the lifetime of this Worker process.
// In dev (mini-oxygen, single process) this works exactly as expected.
// In production on Oxygen (Cloudflare Workers) each isolate has its own memory
// and resets on cold starts — configure Cloudflare Rate Limiting rules in the
// dashboard for true distributed rate limiting without this code.
const ipSubmissions = new Map<string, {count: number; resetAt: number}>();
const RATE_LIMIT = 5;          // max submissions per window per IP
const RATE_WINDOW_MS = 60_000; // 1 minute window (short so it's easy to test)

function getRateLimit(ip: string): {allowed: boolean; remaining: number; retryAfterSecs: number} {
  const now = Date.now();
  const entry = ipSubmissions.get(ip);

  if (!entry || now > entry.resetAt) {
    ipSubmissions.set(ip, {count: 1, resetAt: now + RATE_WINDOW_MS});
    return {allowed: true, remaining: RATE_LIMIT - 1, retryAfterSecs: 0};
  }

  if (entry.count >= RATE_LIMIT) {
    return {allowed: false, remaining: 0, retryAfterSecs: Math.ceil((entry.resetAt - now) / 1000)};
  }

  entry.count++;
  return {allowed: true, remaining: RATE_LIMIT - entry.count, retryAfterSecs: 0};
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Review = {
  id: string;
  productId: string;
  author: string;
  rating: number;
  comment: string;
  createdAt: string;
};

type LoaderData = {
  productId: string;
  ssrReviews: Review[];
  ssrTotal: number;
  ssrError: string | null;
};

type ActionData = {
  success?: boolean;
  review?: Review;
  error?: string;
  remaining?: number; // submissions left in the current rate-limit window
};

// ─── Loader — runs on the server, key injected here ──────────────────────────
export async function loader({request, context}: LoaderFunctionArgs) {
  const {REVIEW_API_URL = 'http://localhost:3001', REVIEW_API_KEY = ''} =
    context.env as Env;

  const url = new URL(request.url);
  const productId = url.searchParams.get('productId') ?? 'the-complete-snowboard';

  try {
    const res = await fetch(
      `${REVIEW_API_URL}/api/reviews?productId=${encodeURIComponent(productId)}`,
      {headers: {'x-api-key': REVIEW_API_KEY}},
    );
    const payload = (await res.json()) as {
      reviews?: Review[];
      total?: number;
      error?: string;
    };
    return data<LoaderData>({
      productId,
      ssrReviews: payload.reviews ?? [],
      ssrTotal: payload.total ?? 0,
      ssrError: payload.error ?? null,
    });
  } catch {
    return data<LoaderData>({
      productId,
      ssrReviews: [],
      ssrTotal: 0,
      ssrError: 'Could not reach the review server. Is it running on port 3001?',
    });
  }
}

// ─── Action — runs on the server, handles both Pattern 1 and Pattern 2 ───────
//
// Both <Form method="post"> and useFetcher.Form with action="/reviews-demo"
// call this function. It runs server-side either way — the API key never
// reaches the browser.
export async function action({request, context}: ActionFunctionArgs) {
  const {REVIEW_API_URL = 'http://localhost:3001', REVIEW_API_KEY = ''} =
    context.env as Env;

  // ── Defense 1: Customer account authentication ────────────────────────────
  // This is the primary gate. A bot must own a verified Shopify customer
  // account to get past this. Uncomment for production.
  // const isLoggedIn = await context.customerAccount.isLoggedIn();
  // if (!isLoggedIn) {
  //   return {error: 'You must be logged in to submit a review.'} as ActionData;
  // }

  // ── Defense 2: IP-based rate limiting ────────────────────────────────────
  // Works against raw curl replays and bots that don't rotate IPs.
  // cf-connecting-ip is set by Cloudflare on Oxygen; fall back to
  // x-forwarded-for for local dev behind mini-oxygen.
  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    'unknown';

  const {allowed, remaining, retryAfterSecs} = getRateLimit(ip);

  if (!allowed) {
    return {
      error: `Too many submissions. Try again in ${retryAfterSecs} seconds.`,
    } as ActionData;
  }

  const fd = await request.formData();
  const productId = fd.get('productId') as string;
  const author = fd.get('author') as string;
  const rating = Number(fd.get('rating'));
  const comment = fd.get('comment') as string;

  if (!productId || !author || !rating || !comment) {
    return {error: 'All fields are required.'} as ActionData;
  }

  try {
    const res = await fetch(`${REVIEW_API_URL}/api/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': REVIEW_API_KEY,
      },
      body: JSON.stringify({productId, author, rating, comment}),
    });
    const result = (await res.json()) as ActionData;
    return {...result, remaining} as ActionData;
  } catch {
    return {error: 'Could not reach the review server.'} as ActionData;
  }
}

// ─── Page component ───────────────────────────────────────────────────────────
export default function ReviewsDemo() {
  const {productId, ssrReviews, ssrTotal, ssrError} = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-12">
      <div>
        <h1 className="text-3xl font-bold mb-2">Third-Party API — Credential Isolation</h1>
        <p className="text-sm text-gray-500 mb-4">
          Open DevTools → Network and search for{' '}
          <code className="bg-gray-100 px-1 rounded">x-api-key</code>. You will
          not find it in any browser request — it only ever appears in
          server-to-server calls.
        </p>
        <div className="flex gap-2 flex-wrap">
          {['the-complete-snowboard', 'demo-product', 'my-custom-product'].map((id) => (
            <a
              key={id}
              href={`/reviews-demo?productId=${id}`}
              className={`px-3 py-1 rounded-full text-sm border ${
                productId === id
                  ? 'bg-black text-white border-black'
                  : 'border-gray-300 hover:border-black'
              }`}
            >
              {id}
            </a>
          ))}
        </div>
      </div>

      {/* ── Pattern 1: loader + <Form> ──────────────────────────────────── */}
      <section className="border rounded-xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <span className="inline-block bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded mb-1">
              Pattern 1 — loader + Form
            </span>
            <h2 className="text-xl font-semibold">SSR read, server-side write</h2>
            <p className="text-sm text-gray-500 mt-1">
              Reviews are in the initial HTML. The{' '}
              <code className="bg-gray-100 px-1 rounded">&lt;Form&gt;</code> POST
              triggers <code className="bg-gray-100 px-1 rounded">action()</code>{' '}
              on the server — the browser never calls the upstream API directly.
            </p>
          </div>
          <code className="text-xs bg-gray-50 border rounded p-2 whitespace-pre shrink-0">
            {`productId: "${productId}"\ntotal: ${ssrTotal}`}
          </code>
        </div>

        {ssrError ? (
          <ErrorBox message={ssrError} />
        ) : (
          <ReviewList reviews={ssrReviews} emptyLabel="No reviews yet — submit one below." />
        )}

        <div className="pt-2 border-t">
          <h3 className="font-medium mb-3">
            Submit{' '}
            <span className="text-xs text-gray-400 font-normal">
              → action() on server → upstream API (key added server-side)
            </span>
          </h3>
          {actionData?.success && (
            <div className="mb-3 bg-green-50 border border-green-200 text-green-700 rounded p-3 text-sm">
              Review submitted!{' '}
              {actionData.remaining !== undefined && (
                <span className="text-green-600">
                  {actionData.remaining} submission{actionData.remaining !== 1 ? 's' : ''} left this window.
                </span>
              )}
            </div>
          )}
          {actionData?.error && <ErrorBox message={actionData.error} />}
          <Form method="post" className="space-y-3">
            <input type="hidden" name="productId" value={productId} />
            <ReviewFormFields submitLabel="Submit Review" />
          </Form>
        </div>
      </section>

      {/* ── Pattern 2: useFetcher targeting the page action ─────────────── */}
      <section className="border rounded-xl p-6 space-y-5">
        <div>
          <span className="inline-block bg-purple-100 text-purple-800 text-xs font-semibold px-2 py-0.5 rounded mb-1">
            Pattern 2 — useFetcher → page action
          </span>
          <h2 className="text-xl font-semibold">Lazy read, fetcher write (no proxy)</h2>
          <p className="text-sm text-gray-500 mt-1">
            Reviews load lazily via{' '}
            <code className="bg-gray-100 px-1 rounded">
              useFetcher.load(&apos;/api/reviews&apos;)
            </code>
            . The submit form uses{' '}
            <code className="bg-gray-100 px-1 rounded">
              action=&quot;/reviews-demo&quot;
            </code>{' '}
            — it calls <em>this file&apos;s</em>{' '}
            <code className="bg-gray-100 px-1 rounded">action()</code> on the
            server. No separate proxy route needed.
          </p>
        </div>

        <FetcherReviewSection productId={productId} />
      </section>

      {/* Security note */}
      <section className="bg-gray-50 rounded-xl p-5 text-sm text-gray-600 space-y-2">
        <h3 className="font-semibold text-gray-800">Why both patterns are secure</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <code className="bg-gray-100 px-1 rounded">loader()</code> and{' '}
            <code className="bg-gray-100 px-1 rounded">action()</code> are always
            server-side in Hydrogen — there is no client bundle for them.
          </li>
          <li>
            <code className="bg-gray-100 px-1 rounded">context.env.REVIEW_API_KEY</code>{' '}
            exists only in the server runtime. It is never serialised into HTML,
            JSON responses, or JS bundles.
          </li>
          <li>
            <code className="bg-gray-100 px-1 rounded">useFetcher</code> can target
            any route&apos;s <code className="bg-gray-100 px-1 rounded">action()</code>{' '}
            without a page navigation — the action still runs on the server.
          </li>
          <li>
            <strong>Rate limiting</strong> — 5 submissions per IP per minute. For
            production, use Cloudflare Rate Limiting rules at the edge.
          </li>
        </ul>
      </section>
    </div>
  );
}

// ─── Pattern 2 — useFetcher component ────────────────────────────────────────
//
// Reads use /api/reviews (GET-only resource route, clean JSON response).
// Writes use action="/reviews-demo" — targets this file's action() server-side.
// No proxy route, no CSRF tokens, no extra complexity.
function FetcherReviewSection({productId}: {productId: string}) {
  const loadFetcher = useFetcher<{reviews: Review[]; total: number; error?: string}>();
  const submitFetcher = useFetcher<ActionData>();
  const [showSuccess, setShowSuccess] = useState(false);

  // Load reviews on mount and whenever productId changes
  useEffect(() => {
    loadFetcher.load(`/api/reviews?productId=${encodeURIComponent(productId)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  // After a successful submit, refresh the review list
  useEffect(() => {
    if (submitFetcher.state === 'idle' && submitFetcher.data?.success) {
      setShowSuccess(true);
      loadFetcher.load(`/api/reviews?productId=${encodeURIComponent(productId)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitFetcher.state, submitFetcher.data]);

  const reviews = loadFetcher.data?.reviews ?? [];
  const isLoading = loadFetcher.state !== 'idle';
  const isSubmitting = submitFetcher.state !== 'idle';

  return (
    <div className="space-y-5">
      {/* Review list */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              loadFetcher.load(`/api/reviews?productId=${encodeURIComponent(productId)}`)
            }
            disabled={isLoading}
            className="bg-purple-600 text-white text-sm px-4 py-1.5 rounded hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {isLoading ? 'Loading…' : 'Reload Reviews'}
          </button>
          {loadFetcher.data && (
            <span className="text-xs text-gray-400">
              {loadFetcher.data.total} review(s) for &ldquo;{productId}&rdquo;
            </span>
          )}
        </div>

        {loadFetcher.data?.error ? (
          <ErrorBox message={loadFetcher.data.error} />
        ) : (
          <ReviewList reviews={reviews} emptyLabel="No reviews yet — submit one below." />
        )}
      </div>

      {/* Submit form — action="/reviews-demo" calls the page's action() server-side */}
      <div className="pt-2 border-t">
        <h3 className="font-medium mb-3">
          Submit{' '}
          <span className="text-xs text-gray-400 font-normal">
            → action(&quot;/reviews-demo&quot;) on server → upstream API
          </span>
        </h3>

        {showSuccess && submitFetcher.data?.success && (
          <div className="mb-3 bg-green-50 border border-green-200 text-green-700 rounded p-3 text-sm">
            Review submitted and list refreshed!
          </div>
        )}
        {submitFetcher.data?.error && <ErrorBox message={submitFetcher.data.error} />}

        {/*
          action="/reviews-demo" — this posts to the reviews-demo route's action().
          That action() runs on the server. The API key is added there.
          No /api/reviews proxy needed for writes.
        */}
        <submitFetcher.Form
          method="post"
          action="/reviews-demo"
          className="space-y-3"
          onSubmit={() => setShowSuccess(false)}
        >
          <input type="hidden" name="productId" value={productId} />
          <ReviewFormFields
            submitLabel={isSubmitting ? 'Submitting…' : 'Submit Review'}
            disabled={isSubmitting}
            buttonClass="bg-purple-600 hover:bg-purple-700"
          />
        </submitFetcher.Form>
      </div>
    </div>
  );
}

// ─── Shared UI components ─────────────────────────────────────────────────────
function ReviewFormFields({
  submitLabel,
  disabled,
  buttonClass = 'bg-black hover:bg-gray-800',
}: {
  submitLabel: string;
  disabled?: boolean;
  buttonClass?: string;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <input
          name="author"
          required
          placeholder="Your name"
          className="border rounded px-3 py-2 text-sm w-full"
        />
        <select
          name="rating"
          required
          className="border rounded px-3 py-2 text-sm w-full"
          defaultValue=""
        >
          <option value="" disabled>
            Rating
          </option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {'★'.repeat(n)} ({n})
            </option>
          ))}
        </select>
      </div>
      <textarea
        name="comment"
        required
        rows={3}
        placeholder="Write your review…"
        className="border rounded px-3 py-2 text-sm w-full"
      />
      <button
        type="submit"
        disabled={disabled}
        className={`${buttonClass} text-white text-sm px-5 py-2 rounded disabled:opacity-50 transition-colors`}
      >
        {submitLabel}
      </button>
    </>
  );
}

function Stars({rating}: {rating: number}) {
  return (
    <span className="text-yellow-400">
      {'★'.repeat(rating)}
      <span className="text-gray-300">{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

function ReviewList({reviews, emptyLabel}: {reviews: Review[]; emptyLabel: string}) {
  if (reviews.length === 0) {
    return <p className="text-sm text-gray-400 italic">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-3">
      {reviews.map((r) => (
        <li key={r.id} className="bg-gray-50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm">{r.author}</span>
            <Stars rating={r.rating} />
            <span className="text-xs text-gray-400 ml-auto">
              {new Date(r.createdAt).toLocaleDateString()}
            </span>
          </div>
          <p className="text-sm text-gray-700">{r.comment}</p>
        </li>
      ))}
    </ul>
  );
}

function ErrorBox({message}: {message: string}) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">
      {message}
    </div>
  );
}
