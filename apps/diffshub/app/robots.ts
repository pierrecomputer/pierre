import type { MetadataRoute } from 'next';

import { SITE_ORIGIN } from '@/lib/site';

// Crawling stays allowed even though the viewer routes are noindex: a crawler
// has to fetch a page to see its noindex directive, so disallowing them here
// would leave any already-indexed viewer URL stuck in the index. The home page
// is the only thing in the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: new URL('/sitemap.xml', SITE_ORIGIN).href,
  };
}
