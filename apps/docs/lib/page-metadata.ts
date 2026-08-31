import type { Metadata } from 'next';

import { type ProductId, PRODUCTS } from './product-config';
import { SITE, SITE_ORIGIN } from './site-origin';

const OG_IMAGE_BY_SITE: Record<ProductId, string> = {
  diffs: '/diffs-brand/opengraph-image.png',
  trees: '/trees-brand/opengraph-image.png',
};

const TWITTER_IMAGE_BY_SITE: Record<ProductId, string> = {
  diffs: '/diffs-brand/twitter-image.png',
  trees: '/trees-brand/twitter-image.png',
};

export interface PageMetadataOptions {
  /** Page title, slotted into the `%s` template from `app/layout.tsx`. */
  title: string;
  description: string;
  /** Route this page is served from (e.g. `/docs`), used for the canonical. */
  path: string;
  /** Overrides the per-site card art for routes that ship their own image. */
  image?: string;
}

/**
 * Build a page's Metadata with the fields search engines and social cards need:
 * a self-referencing canonical (so query-string variants such as
 * `/playground?theme=…` collapse onto one indexable URL), `og:url`,
 * `og:site_name`, `og:type`, and the correct per-site card images.
 *
 * This exists because Next.js REPLACES nested metadata objects like `openGraph`
 * and `twitter` from parent segments instead of deep-merging them, so every
 * page that overrides a title has to restate its entire card. Hand-writing that
 * per page is how routes ended up sharing one title and shipping no canonical.
 */
export function pageMetadata({
  title,
  description,
  path,
  image,
}: PageMetadataOptions): Metadata {
  const canonical = new URL(path, SITE_ORIGIN).href;
  const ogImage = image ?? OG_IMAGE_BY_SITE[SITE];
  const twitterImage = image ?? TWITTER_IMAGE_BY_SITE[SITE];

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      images: [ogImage],
      siteName: PRODUCTS[SITE].name,
      type: 'website',
      url: canonical,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [twitterImage],
    },
  };
}
