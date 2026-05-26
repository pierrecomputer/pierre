import type { MetadataRoute } from 'next';

import { type ProductId, PRODUCTS } from '@/lib/product-config';

const SITE = (process.env.NEXT_PUBLIC_SITE ?? 'diffs') as ProductId;

// All apple-icon.png assets are 640×640, satisfying Chrome's ≥192px install
// prompt and ≥512px splash-screen requirements.
const APPLE_ICON_SIZE = '640x640';

// diffshub is a full standalone app (viewport-fit cover); diffs and trees are
// documentation sites that benefit from keeping browser navigation visible.
const DISPLAY_BY_SITE: Record<ProductId, MetadataRoute.Manifest['display']> = {
  diffs: 'minimal-ui',
  trees: 'minimal-ui',
  diffshub: 'standalone',
};

// diffshub body uses --diffshub-sidebar-bg (#f7f7f7) rather than plain white.
// The manifest only accepts a single theme_color, so we use the light value;
// dark-mode tinting is handled via themeColor in the viewport export.
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
    background_color: '#ffffff',
    theme_color: THEME_COLOR_BY_SITE[SITE],
    categories: ['developer', 'productivity'],
    icons: [
      {
        src: `/${SITE}-brand/icon.svg`,
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
