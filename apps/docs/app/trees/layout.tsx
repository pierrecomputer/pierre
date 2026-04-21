import type { Metadata } from 'next';

import { PRODUCTS } from '../product-config';

// Trees-brand defaults inherited by every Trees route (`/trees`,
// `/trees/docs`). Icons and the shared OG/Twitter card image come in
// via the file-convention assets that live alongside this file
// (`icon.{ico,svg}`, `apple-icon.png`, `opengraph-image.png`,
// `twitter-image.png`). The worktree-prefix title `template` lives on
// the root layout and composes with the inner `%s` here.
//
// `icons: null` is a defensive escape hatch: on `diffs.com` the root
// layout declares Diffs favicons explicitly, and `/trees/*` is
// supposed to 308 redirect out before this layout renders. If a
// /trees route ever does render on `diffs.com`, this clears the
// inherited Diffs `icons` so the file-convention assets above take
// over instead.
const baseTitle = `${PRODUCTS.trees.name}, from Pierre`;
const description = PRODUCTS.trees.description;

export const metadata: Metadata = {
  title: { default: baseTitle, template: '%s' },
  description,
  icons: null,
  openGraph: {
    title: { default: baseTitle, template: '%s' },
    description,
  },
  twitter: {
    card: 'summary_large_image',
    title: { default: baseTitle, template: '%s' },
    description,
  },
};

export default function TreesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
