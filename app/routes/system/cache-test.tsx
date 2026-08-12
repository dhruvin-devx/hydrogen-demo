import {data} from 'react-router';
import {useLoaderData} from 'react-router';
import {generateCacheControlHeader, CacheLong} from '@shopify/hydrogen';

export function headers() {
  return {
    'Oxygen-Cache-Control':
      'public, max-age=3600, stale-while-revalidate=86400',
    Vary: 'Accept-Encoding',
  };
}

export async function loader() {
  return data(
    {serverRenderedAt: new Date().toISOString()},
    {
      headers: {
        'Oxygen-Cache-Control':
          'public, max-age=3600, stale-while-revalidate=86400',
        Vary: 'Accept-Encoding',
      },
    },
  );
}

export default function CacheTest() {
  const {serverRenderedAt} = useLoaderData<typeof loader>();
  return (
    <div style={{padding: '2rem', fontFamily: 'monospace'}}>
      <h1>Full-page cache test</h1>
      <p>
        <strong>Server rendered at:</strong> {serverRenderedAt}
      </p>
      <p style={{color: '#888', fontSize: '0.875rem'}}>
        Deploy to Oxygen and reload this page multiple times.
        <br />
        If the timestamp <strong>freezes</strong> → full-page cache is working.
        <br />
        If it <strong>changes</strong> every reload → Worker is running every
        request (cache miss or bypass).
      </p>
      <p style={{color: '#888', fontSize: '0.875rem'}}>
        Check <code>CF-Cache-Status</code> and <code>Cache-Control</code> in
        DevTools → Network → response headers.
      </p>
    </div>
  );
}
