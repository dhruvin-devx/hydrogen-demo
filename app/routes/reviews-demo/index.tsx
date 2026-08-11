/**
 * /reviews-demo — demonstrates two patterns for calling a third-party API
 * from a Hydrogen / React Router app such that credentials NEVER appear in
 * the browser's Network tab.
 *
 * Pattern 1  →  loader()  calls the API directly on the server (SSR).
 * Pattern 2  →  useFetcher calls /api/reviews, a thin server-side proxy.
 *
 * only ever sees Hydrogen's own URLs.
 */

import {useLoaderData, useFetcher, Form, useActionData, data} from 'react-router';
import type {LoaderFunctionArgs, ActionFunctionArgs} from 'react-router';
import {useState, useEffect} from 'react';

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
  pattern1Reviews: Review[];
  pattern1Total: number;
  pattern1Error: string | null;
};

type ActionData = {
  success?: boolean;
  review?: Review;
  error?: string;
};

// ─── Loader — Pattern 1 ───────────────────────────────────────────────────────
// Runs on the server only. The API key is read from context.env (Workers runtime)
// and used here. It never travels to the browser.
export async function loader({request, context}: LoaderFunctionArgs) {
  // context.env is the correct way to access env vars in Hydrogen's Workers runtime.
  // process.env is NOT available in mini-oxygen — always use context.env.
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
      pattern1Reviews: payload.reviews ?? [],
      pattern1Total: payload.total ?? 0,
      pattern1Error: payload.error ?? null,
    });
  } catch {
    return data<LoaderData>({
      productId,
      pattern1Reviews: [],
      pattern1Total: 0,
      pattern1Error:
        'Could not reach the review server. Is it running on port 3001?',
    });
  }
}

// ─── Action — Pattern 1 form submission ──────────────────────────────────────
export async function action({request, context}: ActionFunctionArgs) {
  const {REVIEW_API_URL = 'http://localhost:3001', REVIEW_API_KEY = ''} =
    context.env as Env;

  const fd = await request.formData();
  const productId = fd.get('productId') as string;
  const author = fd.get('author') as string;
  const rating = Number(fd.get('rating'));
  const comment = fd.get('comment') as string;

  try {
    const res = await fetch(`${REVIEW_API_URL}/api/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': REVIEW_API_KEY, // injected server-side — never reaches browser
      },
      body: JSON.stringify({productId, author, rating, comment}),
    });
    return (await res.json()) as ActionData;
  } catch {
    return {error: 'Could not reach the review server.'} as ActionData;
  }
}

// ─── Page component ───────────────────────────────────────────────────────────
export default function ReviewsDemo() {
  const {productId, pattern1Reviews, pattern1Total, pattern1Error} =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Third-Party API Demo</h1> 
        <div className="mt-3 flex gap-2 flex-wrap">
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

      {/* ── Pattern 1: Loader (SSR) ─────────────────────────────────────── */}
      <section className="border rounded-xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <span className="inline-block bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded mb-1">
              Pattern 1 — Loader (SSR)
            </span>
            <h2 className="text-xl font-semibold">Reviews via server loader</h2>
            <p className="text-sm text-gray-500 mt-1">
              <code className="bg-gray-100 px-1 rounded">loader()</code> fetches
              reviews before the page HTML is sent to the browser. The API key is
              never serialised into the response — inspect the page source and you
              won't find it.
            </p>
          </div>
          <code className="text-xs bg-gray-50 border rounded p-2 whitespace-pre shrink-0">
            {`productId: "${productId}"\ntotal: ${pattern1Total}`}
          </code>
        </div>

        {pattern1Error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">
            {pattern1Error}
          </div>
        ) : (
          <ReviewList reviews={pattern1Reviews} emptyLabel="No reviews yet — submit one below." />
        )}

        {/* Pattern 1 submit form */}
        <div className="pt-2 border-t">
          <h3 className="font-medium mb-3">
            Submit a review{' '}
            <span className="text-xs text-gray-400 font-normal">(action on server)</span>
          </h3>
          {actionData?.success && (
            <div className="mb-3 bg-green-50 border border-green-200 text-green-700 rounded p-3 text-sm">
              Review submitted! Reload the page to see it in Pattern 1.
            </div>
          )}
          {actionData?.error && (
            <div className="mb-3 bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">
              {actionData.error}
            </div>
          )}
          <Form method="post" className="space-y-3">
            <input type="hidden" name="productId" value={productId} />
            <ReviewFormFields />
          </Form>
        </div>
      </section>

      {/* ── Pattern 2: useFetcher (proxy route) ─────────────────────────── */}
      <section className="border rounded-xl p-6 space-y-5">
        <div>
          <span className="inline-block bg-purple-100 text-purple-800 text-xs font-semibold px-2 py-0.5 rounded mb-1">
            Pattern 2 — useFetcher (proxy route)
          </span>
          <h2 className="text-xl font-semibold">Reviews via fetcher + proxy</h2>
          <p className="text-sm text-gray-500 mt-1">
            The browser calls{' '}
            <code className="bg-gray-100 px-1 rounded">/api/reviews</code> (a
            Hydrogen route). That route adds the API key on the server and forwards
            the request to the standalone server. Check the Network tab — the
            request to <code className="bg-gray-100 px-1 rounded">/api/reviews</code>{' '}
            carries <strong>no</strong>{' '}
          </p>
        </div>

        <FetcherReviewSection productId={productId} />
      </section>

      {/* Architecture note */}
      <section className="bg-gray-50 rounded-xl p-6 text-sm text-gray-600 space-y-2">
        <h3 className="font-semibold text-gray-800">How credentials stay hidden</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Pattern 1</strong>: <code>loader()</code> runs on the server.
            The API key is read from <code>context.env</code> and used only to build
            the upstream request — it is never serialised into the HTML or any browser
            response.
          </li>
          <li>
            <strong>Pattern 2</strong>: The browser calls{' '}
            <code>/api/reviews</code> (a Hydrogen proxy route). That route runs on
            the server and injects the API key before forwarding to the upstream
            service.
          </li>
        </ul>
      </section>
    </div>
  );
}

// ─── Shared form fields ───────────────────────────────────────────────────────
function ReviewFormFields({defaultProductId}: {defaultProductId?: string}) {
  return (
    <>
      {defaultProductId && (
        <input type="hidden" name="productId" value={defaultProductId} />
      )}
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
        className="bg-black text-white text-sm px-5 py-2 rounded hover:bg-gray-800 transition-colors"
      >
        Submit Review
      </button>
    </>
  );
}

// ─── Star display ─────────────────────────────────────────────────────────────
function Stars({rating}: {rating: number}) {
  return (
    <span className="text-yellow-400">
      {'★'.repeat(rating)}
      <span className="text-gray-300">{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

// ─── Review list ──────────────────────────────────────────────────────────────
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

// ─── Pattern 2 component — uses useFetcher for both load and submit ───────────
function FetcherReviewSection({productId}: {productId: string}) {
  const loadFetcher = useFetcher<{reviews: Review[]; total: number; error?: string}>();
  const submitFetcher = useFetcher<{success?: boolean; review?: Review; error?: string}>();
  const [submitted, setSubmitted] = useState(false);

  // Auto-load reviews once on mount
  useEffect(() => {
    loadFetcher.load(`/api/reviews?productId=${encodeURIComponent(productId)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  // Reset submitted flag when fetcher goes idle again
  useEffect(() => {
    if (submitFetcher.state === 'idle' && submitFetcher.data?.success) {
      setSubmitted(true);
      // Reload the review list after a successful submit
      loadFetcher.load(`/api/reviews?productId=${encodeURIComponent(productId)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitFetcher.state, submitFetcher.data]);

  const reviews = loadFetcher.data?.reviews ?? [];
  const isLoading = loadFetcher.state !== 'idle';
  const isSubmitting = submitFetcher.state !== 'idle';

  return (
    <div className="space-y-5">
      {/* Load button + review list */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() =>
              loadFetcher.load(
                `/api/reviews?productId=${encodeURIComponent(productId)}`,
              )
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
          <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">
            {loadFetcher.data.error}
          </div>
        ) : (
          <ReviewList
            reviews={reviews}
            emptyLabel="No reviews yet — submit one below."
          />
        )}
      </div>

      {/* Pattern 2 submit form */}
      <div className="pt-2 border-t">
        <h3 className="font-medium mb-3">
          Submit a review{' '}
          <span className="text-xs text-gray-400 font-normal">
            (fetcher.submit → proxy route → standalone server)
          </span>
        </h3>

        {submitted && submitFetcher.data?.success && (
          <div className="mb-3 bg-green-50 border border-green-200 text-green-700 rounded p-3 text-sm">
            Review submitted and list refreshed automatically!
          </div>
        )}
        {submitFetcher.data?.error && (
          <div className="mb-3 bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">
            {submitFetcher.data.error}
          </div>
        )}

        <submitFetcher.Form
          method="post"
          action="/api/reviews"
          className="space-y-3"
          onSubmit={() => setSubmitted(false)}
        >
          <input type="hidden" name="productId" value={productId} />
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
            disabled={isSubmitting}
            className="bg-purple-600 text-white text-sm px-5 py-2 rounded hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? 'Submitting…' : 'Submit Review'}
          </button>
        </submitFetcher.Form>
      </div>
    </div>
  );
}
