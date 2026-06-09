import { notFound, redirect } from 'next/navigation';

import { ReviewUI } from '../_components/ReviewUI';
import { resolveDiffshubViewerRoute } from '../_components/utils';

const SITE = process.env.NEXT_PUBLIC_SITE;

// Viewer route that mirrors the upstream path. GitHub is the public default,
// while hidden alternate domains can opt in through the `domain` query param.
export default async function DiffshubViewByPathPage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ domain?: string | string[] }>;
}) {
  const { path } = await params;
  const { domain } = await searchParams;
  const requestedDomain = Array.isArray(domain) ? domain[0] : domain;
  const route = resolveDiffshubViewerRoute(path, requestedDomain, SITE);
  if (route.kind === 'notFound') {
    notFound();
  }

  if (route.kind === 'redirect') {
    redirect(route.target);
  }

  return (
    <div className="flex h-dvh flex-col gap-2">
      <ReviewUI
        domain={route.domain}
        initialUrl={route.url}
        path={route.upstreamPath}
      />
    </div>
  );
}
