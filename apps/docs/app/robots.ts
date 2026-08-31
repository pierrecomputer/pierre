import type { MetadataRoute } from 'next';

import { SITE_ORIGIN } from '@/lib/site-origin';

// Both sites are fully public marketing/docs, so the only job here is to point
// crawlers at the sitemap — without a robots.txt they get neither crawl
// guidance nor a URL inventory, which matters because `/docs` is a single route
// whose sections are hash anchors rather than followable links.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: new URL('/sitemap.xml', SITE_ORIGIN).href,
  };
}
