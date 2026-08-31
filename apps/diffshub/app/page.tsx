import type { Metadata } from 'next';

import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN } from '@/lib/site';

// Declared here rather than in `app/layout.tsx` so only the home page claims `/`
// as its canonical; a layout-level canonical would be inherited by every viewer
// route that did not override it.
export const metadata: Metadata = {
  alternates: { canonical: `${SITE_ORIGIN}/` },
  openGraph: {
    title: `${SITE_NAME}, from Pierre`,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    type: 'website',
    url: `${SITE_ORIGIN}/`,
    images: ['/diffshub-brand/opengraph-image.png'],
  },
};

// The diffshub home page. The implementation lives in `_home/HomePage.tsx` so it
// keeps its sibling imports; this route file just re-exports it as the `/`
// default.
export { HomePage as default } from './_home/HomePage';
