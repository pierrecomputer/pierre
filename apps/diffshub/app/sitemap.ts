import type { MetadataRoute } from 'next';

import { SITE_ORIGIN } from '@/lib/site';

// Only the home page. The catch-all viewer mirrors arbitrary upstream paths, so
// there is no finite URL set to enumerate, and those pages render third-party
// diffs client-side rather than content of our own worth indexing.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_ORIGIN}/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
