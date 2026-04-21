import type { Metadata } from 'next';

import { PRODUCTS } from '../product-config';

// `icons: null` clears any `icons` declared on the root layout so the
// file-convention assets in this segment (`icon.{ico,svg}`,
// `apple-icon.png`) take over.
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
