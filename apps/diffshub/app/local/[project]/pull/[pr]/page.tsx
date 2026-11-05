import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReviewUI } from '@/components/ReviewUI';
import { resolveLocalProject } from '@/lib/localProjects.server';
import { isValidPrNumber, type LocalViewerSource } from '@/lib/localSource';
import { SITE_NAME } from '@/lib/site';

interface LocalPullPageProps {
  params: Promise<{ project: string; pr: string }>;
}

export async function generateMetadata({
  params,
}: LocalPullPageProps): Promise<Metadata> {
  const { project, pr } = await params;
  const resolved = resolveLocalProject(project);
  const title =
    resolved != null && isValidPrNumber(pr)
      ? `${resolved.label} #${pr} — ${SITE_NAME}`
      : SITE_NAME;
  return { title, robots: { index: false, follow: false } };
}

// Local-mode viewer for a PR: the diff is produced server-side by
// `gh pr diff <pr> --repo <repo>` in the project's local checkout.
export default async function LocalPullPage({ params }: LocalPullPageProps) {
  const { project, pr } = await params;
  const resolved = resolveLocalProject(project);
  if (resolved == null || !isValidPrNumber(pr)) {
    notFound();
  }
  const localSource: LocalViewerSource = {
    project: resolved.id,
    target: { kind: 'pull', pr },
  };
  return (
    <div className="flex h-dvh flex-col gap-2">
      <ReviewUI
        initialUrl={`https://github.com/${resolved.repo}/pull/${pr}`}
        path={`/local/${resolved.id}/pull/${pr}`}
        localSource={localSource}
      />
    </div>
  );
}
