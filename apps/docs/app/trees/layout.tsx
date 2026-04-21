import type { Metadata } from 'next';

import { TREES_PRODUCT_DESCRIPTION, TREES_TITLE } from './metadata';

export const metadata: Metadata = {
  // Clear the root layout's `metadata.icons` so Next.js falls back to the
  // file-based conventions colocated with this segment (`icon.ico` and
  // `apple-icon.png` in `app/trees/`). Without this override, the explicit
  // `icons` object in the root layout takes precedence and the trees-specific
  // icons are dropped from the head.
  icons: null,
  openGraph: {
    title: TREES_TITLE,
    description: TREES_PRODUCT_DESCRIPTION,
  },
  twitter: {
    title: TREES_TITLE,
    description: TREES_PRODUCT_DESCRIPTION,
  },
};

export default function TreesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
