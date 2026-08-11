import http from 'node:http';

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = 3001;
const API_KEY = 'REVIEW-API-KEY-SECRET-123'; // must match REVIEW_API_KEY in Hydrogen .env

// ─── Types ────────────────────────────────────────────────────────────────────
type Review = {
  id: string;
  productId: string;
  author: string;
  rating: number; // 1-5
  comment: string;
  createdAt: string;
};

// ─── In-memory store ──────────────────────────────────────────────────────────
// productId (handle) → Review[]
const store = new Map<string, Review[]>();

// Seed a couple of reviews so the demo shows data immediately
const seeds: Review[] = [
  {
    id: 'seed-1',
    productId: 'the-complete-snowboard',
    author: 'Alice M.',
    rating: 5,
    comment: 'Absolutely love this board — carves like a dream.',
    createdAt: new Date(Date.now() - 86_400_000 * 3).toISOString(),
  },
  {
    id: 'seed-2',
    productId: 'the-complete-snowboard',
    author: 'Bob K.',
    rating: 4,
    comment: 'Great quality. Arrived fast.',
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
  {
    id: 'seed-3',
    productId: 'demo-product',
    author: 'Carol W.',
    rating: 5,
    comment: 'Works perfectly, highly recommend!',
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  },
];

for (const r of seeds) {
  store.set(r.productId, [...(store.get(r.productId) ?? []), r]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isAuthenticated(req: http.IncomingMessage): boolean {
  return req.headers['x-api-key'] === API_KEY;
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*', // server-to-server only; safe here
  });
  res.end(payload);
}

// ─── Server ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // CORS preflight (for any same-machine browser testing)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    });
    res.end();
    return;
  }

  // ── Auth gate ──────────────────────────────────────────────────────────────
  if (!isAuthenticated(req)) {
    console.log(`[401] ${req.method} ${url.pathname} — missing/invalid API key`);
    json(res, 401, {error: 'Unauthorized: provide a valid x-api-key header'});
    return;
  }

  // ── GET /api/reviews?productId=<handle> ───────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/reviews') {
    const productId = url.searchParams.get('productId');
    if (!productId) {
      json(res, 400, {error: '`productId` query param is required'});
      return;
    }
    const reviews = store.get(productId) ?? [];
    console.log(`[200] GET /api/reviews?productId=${productId} → ${reviews.length} reviews`);
    json(res, 200, {productId, reviews, total: reviews.length});
    return;
  }

  // ── POST /api/reviews ─────────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/reviews') {
    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, {error: 'Could not parse JSON body'});
      return;
    }

    const {productId, author, rating, comment} = body;
    if (!productId || !author || rating === undefined || !comment) {
      json(res, 400, {
        error: 'Required fields: productId, author, rating (1-5), comment',
      });
      return;
    }
    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      json(res, 400, {error: '`rating` must be an integer between 1 and 5'});
      return;
    }

    const review: Review = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      productId: String(productId),
      author: String(author),
      rating: ratingNum,
      comment: String(comment),
      createdAt: new Date().toISOString(),
    };

    store.set(review.productId, [...(store.get(review.productId) ?? []), review]);
    console.log(`[201] POST /api/reviews — new review by "${review.author}" for "${review.productId}"`);
    json(res, 201, {success: true, review});
    return;
  }

  json(res, 404, {error: `No route: ${req.method} ${url.pathname}`});
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ✓ Review API server  →  http://localhost:' + PORT);
  console.log('  ✓ API key            →  ' + API_KEY);
  console.log('');
  console.log('  Endpoints:');
  console.log('    GET  /api/reviews?productId=<handle>');
  console.log('    POST /api/reviews   { productId, author, rating, comment }');
  console.log('');
});
