import DiffsHome from './(diffs)/_home/Home';
// Build-time dispatcher: each site (NEXT_PUBLIC_SITE=diffs|trees) renders its
// own product's home page at `/`. All modules are imported statically so
// webpack can dead-code-eliminate the inactive branch when
// `process.env.NEXT_PUBLIC_SITE` is statically replaced at build.
import TreesHome from './(trees)/_home/Home';
import { pageMetadata } from '@/lib/page-metadata';
import { PRODUCTS } from '@/lib/product-config';
import { SITE } from '@/lib/site-origin';

const SITE_PRODUCT = PRODUCTS[SITE];

// The title and description repeat `app/layout.tsx`'s per-site defaults on
// purpose: this export exists so `/` gets a canonical and `og:url` of its own.
// Declaring those in the root layout instead would make every child route that
// forgot to override them claim `/` as its canonical.
export const metadata = pageMetadata({
  title: `${SITE_PRODUCT.name}, from Pierre`,
  description: SITE_PRODUCT.description,
  path: '/',
});

const Page = SITE === 'trees' ? TreesHome : DiffsHome;
export default Page;
