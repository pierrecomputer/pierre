import { redirect } from 'next/navigation';

import { ReviewUI } from '../_components/ReviewUI';

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
  if (path.length === 0) {
    redirect('/');
  }
  const requestedDomain = Array.isArray(domain) ? domain[0] : domain;
  const upstreamPath = `/${path.join('/')}`;
  const host =
    requestedDomain == null || requestedDomain === ''
      ? 'github.com'
      : requestedDomain;
  const url = `https://${host}${upstreamPath}`;

  return (
    <div className="flex h-dvh flex-col gap-2">
      <ReviewUI domain={requestedDomain} initialUrl={url} path={upstreamPath} />
    </div>
  );
}
