// DEMO COMPONENT — code-split target.
//
// This file is imported via React.lazy() in routes/system/lazy-demo.tsx, so the
// bundler emits it as its OWN JavaScript chunk. It is NOT included in the initial
// page bundle. The console.log below runs the moment the chunk is downloaded and
// executed in the browser — watch for it in DevTools > Console when you scroll.

import {useEffect} from 'react';

// eslint-disable-next-line no-console
console.log(
  '%c[lazy-demo] HeavyReviews chunk downloaded + executed',
  'color:#fff;background:#7b3fe4;padding:2px 6px;border-radius:3px',
);

// Pretend this component pulls in a large dependency (a charting lib, a video
// player, a rich-text editor, etc.). We simulate the weight with filler content.
const FAKE_REVIEWS = Array.from({length: 8}, (_, i) => ({
  id: i + 1,
  author: [
    'Ada',
    'Linus',
    'Grace',
    'Alan',
    'Margaret',
    'Dennis',
    'Barbara',
    'Ken',
  ][i],
  stars: 4 + (i % 2),
  body:
    'This is a heavy below-the-fold widget. It only shipped to the browser ' +
    'after you scrolled near it, keeping the initial JS bundle small.',
}));

export default function HeavyReviews() {

  return (
    <div
      style={{
        display: 'grid',
        gap: '1rem',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
      }}
    >
      {FAKE_REVIEWS.map((r) => (
        <figure
          key={r.id}
          style={{
            margin: 0,
            padding: '1rem',
            border: '1px solid #e5e5e5',
            borderRadius: 8,
          }}
        >
          <figcaption style={{fontWeight: 600}}>
            {r.author} — {'★'.repeat(r.stars)}
            {'☆'.repeat(5 - r.stars)}
          </figcaption>
          <blockquote style={{margin: '0.5rem 0 0'}}>{r.body}</blockquote>
        </figure>
      ))}
    </div>
  );
}
