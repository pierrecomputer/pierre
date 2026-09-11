import type { MetadataRoute } from 'next';

import type { ProductId } from '@/lib/product-config';
import { SITE, SITE_ORIGIN } from '@/lib/site-origin';

type SitemapEntry = MetadataRoute.Sitemap[number];

interface SitemapRoute {
  path: string;
  priority: number;
  changeFrequency: NonNullable<SitemapEntry['changeFrequency']>;
}

// Listed per site because `app/(diffs)/layout.tsx` and `app/(trees)/layout.tsx`
// call notFound() for the other product's routes: advertising both sets would
// point crawlers at guaranteed 404s. Priorities rank the marketing home page and
// docs above the interactive demos, which are useful but not what we want
// ranking for product queries.
const ROUTES_BY_SITE: Record<ProductId, readonly SitemapRoute[]> = {
  diffs: [
    { path: '/', priority: 1, changeFrequency: 'weekly' },
    { path: '/docs', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/highlights', priority: 0.8, changeFrequency: 'weekly' },
    { path: '/edit', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/theme', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/theme/gallery', priority: 0.5, changeFrequency: 'monthly' },
    { path: '/playground', priority: 0.5, changeFrequency: 'monthly' },
    { path: '/edit/live', priority: 0.4, changeFrequency: 'monthly' },
    { path: '/ssr', priority: 0.3, changeFrequency: 'monthly' },
  ],
  trees: [
    { path: '/', priority: 1, changeFrequency: 'weekly' },
    { path: '/docs', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/trees-dev', priority: 0.5, changeFrequency: 'monthly' },
    { path: '/trees-dev/react', priority: 0.4, changeFrequency: 'monthly' },
    { path: '/trees-dev/search', priority: 0.4, changeFrequency: 'monthly' },
    {
      path: '/trees-dev/git-status',
      priority: 0.4,
      changeFrequency: 'monthly',
    },
    { path: '/trees-dev/density', priority: 0.4, changeFrequency: 'monthly' },
    {
      path: '/trees-dev/item-customization',
      priority: 0.4,
      changeFrequency: 'monthly',
    },
    {
      path: '/trees-dev/drag-and-drop',
      priority: 0.4,
      changeFrequency: 'monthly',
    },
    {
      path: '/trees-dev/responsiveness',
      priority: 0.4,
      changeFrequency: 'monthly',
    },
  ],
};

export default function sitemap(): MetadataRoute.Sitemap {
  // These routes are defined in code, not authored content, so "last modified"
  // is really "last deployed" — one build timestamp for every entry.
  const lastModified = new Date();

  return ROUTES_BY_SITE[SITE].map(({ path, priority, changeFrequency }) => ({
    url: new URL(path, SITE_ORIGIN).href,
    lastModified,
    changeFrequency,
    priority,
  }));
}
