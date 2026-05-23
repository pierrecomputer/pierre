import type { MetadataRoute } from 'next';

import { type ProductId, PRODUCTS } from '@/lib/product-config';

const SITE = (process.env.NEXT_PUBLIC_SITE ?? 'diffs') as ProductId;

// SVG icon path is per-site; diffs uses the root favicon since it predates
// the *-brand directory convention.
const ICON_SVG_BY_SITE: Record<ProductId, string> = {
  diffs: '/favicon.svg',
  trees: '/trees-brand/icon.svg',
  diffshub: '/diffshub-brand/icon.svg',
};

// Chrome needs ≥192px for icon, ≥512px for the splash-screen
const APPLE_ICON_SIZE = '640x640';

// diffshub behaves like a standalone app (viewport-fit cover, no browser chrome desired), while the diffs/trees sites are primarily documentation and benefit from keeping browser navigation controls visible.
const DISPLAY_BY_SITE: Record<ProductId, MetadataRoute.Manifest['display']> = {
  diffs: 'minimal-ui',
  trees: 'minimal-ui',
  diffshub: 'standalone',
};

// Match the body background per site. diffshub uses --diffshub-sidebar-bg
// (#f7f7f7 light / #101010 dark) rather than the plain neutral palette used
// by diffs and trees. The manifest only accepts one theme_color; we use the
// light value since that pairs with the white background_color.
const THEME_COLOR_BY_SITE: Record<ProductId, string> = {
  diffs: '#ffffff',
  trees: '#ffffff',
  diffshub: '#f7f7f7',
};

export default function manifest(): MetadataRoute.Manifest {
  const product = PRODUCTS[SITE];

  return {
    name: `${product.name}, from Pierre`,
    short_name: product.name,
    description: product.description,
    id: '/',
    start_url: '/',
    display: DISPLAY_BY_SITE[SITE],
    orientation: 'any',
    lang: 'en',
    dir: 'ltr',
    // Match the light-mode background. The dark-mode browser chrome tint is
    // handled separately via themeColor in the viewport export, which supports
    // media-query-based light/dark values that the manifest spec doesn't allow.
    background_color: '#ffffff',
    theme_color: THEME_COLOR_BY_SITE[SITE],
    categories: ['developer', 'productivity'],
    icons: [
      {
        src: ICON_SVG_BY_SITE[SITE],
        type: 'image/svg+xml',
        sizes: 'any',
        purpose: 'any',
      },
      {
        src: `/${SITE}-brand/apple-icon.png`,
        type: 'image/png',
        sizes: APPLE_ICON_SIZE,
        purpose: 'any',
      },
      {
        src: `/${SITE}-brand/apple-icon.png`,
        type: 'image/png',
        sizes: APPLE_ICON_SIZE,
        purpose: 'maskable',
      },
    ],
  };
}
