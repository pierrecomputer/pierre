import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

// Gates every route in the (trees) group to the trees build — the parallel of
// (diffs)/layout.tsx. Route groups don't prune, so without this the trees-only
// /trees-dev routes would also resolve on diffs.com. One build-time-constant
// gate 404s the whole group in any build that isn't trees.
export default function TreesGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  if ((process.env.NEXT_PUBLIC_SITE ?? 'diffs') !== 'trees') {
    notFound();
  }
  return <>{children}</>;
}
