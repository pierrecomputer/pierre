import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReviewUI } from '@/components/ReviewUI';
import { resolveLocalProject } from '@/lib/localProjects.server';
import { isValidCompareRange, type LocalViewerSource } from '@/lib/localSource';
import { SITE_NAME } from '@/lib/site';

interface LocalComparePageProps {
  params: Promise<{ project: string; range: string[] }>;
}

export async function generateMetadata({
  params,
}: LocalComparePageProps): Promise<Metadata> {
  const { project, range } = await params;
  const resolved = resolveLocalProject(project);
  const joined = range.join('/');
  const title =
    resolved != null && isValidCompareRange(joined)
      ? `${resolved.label} ${joined} — ${SITE_NAME}`
      : SITE_NAME;
  return { title, robots: { index: false, follow: false } };
}

// Local-mode viewer for a ref range: the diff is produced server-side by
// `git diff <range>` in the project's local checkout (branch names with
// slashes arrive as multiple catch-all segments and are rejoined).
export default async function LocalComparePage({
  params,
}: LocalComparePageProps) {
  const { project, range } = await params;
  const resolved = resolveLocalProject(project);
  const joined = range.join('/');
  if (resolved == null || !isValidCompareRange(joined)) {
    notFound();
  }
  const localSource: LocalViewerSource = {
    project: resolved.id,
    target: { kind: 'compare', range: joined },
  };
  return (
    <div className="flex h-dvh flex-col gap-2">
      <ReviewUI
        initialUrl={`https://github.com/${resolved.repo}/compare/${joined}`}
        path={`/local/${resolved.id}/compare/${joined}`}
        localSource={localSource}
      />
    </div>
  );
}
