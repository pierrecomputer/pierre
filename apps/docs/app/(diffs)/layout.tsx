import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

// Gates every route in the (diffs) group to the diffs build. Route groups are
// not build or URL boundaries — Next compiles each group's routes into every
// NEXT_PUBLIC_SITE build — so without this gate diffs-only routes like
// /playground would also resolve on trees.software. NEXT_PUBLIC_SITE is a
// build-time constant, so one gate here makes the whole group 404 in any
// build that isn't diffs (unset defaults to diffs, matching the rest of the app).
export default function DiffsGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  if ((process.env.NEXT_PUBLIC_SITE ?? 'diffs') !== 'diffs') {
    notFound();
  }
  return <>{children}</>;
}
