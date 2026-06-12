import { redirect } from 'next/navigation';

import { ReviewUI } from '@/components/ReviewUI';
import { resolveDiffshubViewerRoute } from '@/lib/resolveDiffshubViewerRoute';

// Viewer route that mirrors the upstream path. GitHub is the public default,
// while hidden alternate domains can opt in through the `domain` query param.
export async function DiffsHubViewByPathPage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ domain?: string | string[] }>;
}) {
  const { path } = await params;
  const { domain } = await searchParams;
  const requestedDomain = Array.isArray(domain) ? domain[0] : domain;
  const route = resolveDiffshubViewerRoute(path, requestedDomain);

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
