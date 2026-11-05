import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReviewUI } from '@/components/ReviewUI';
import { tryResolveLocalProject } from '@/lib/localProjectsServer';
import type { LocalViewerSource } from '@/lib/localSource';
import { SITE_NAME } from '@/lib/site';

interface LocalWorktreePageProps {
  params: Promise<{ project: string }>;
}

export async function generateMetadata({
  params,
}: LocalWorktreePageProps): Promise<Metadata> {
  const { project } = await params;
  const resolved = tryResolveLocalProject(project);
  const title =
    resolved != null
      ? `${resolved.label} local changes — ${SITE_NAME}`
      : SITE_NAME;
  return { title, robots: { index: false, follow: false } };
}

// Local-mode viewer for uncommitted work: the diff is produced server-side by
// `git diff HEAD` in the project's local checkout.
export default async function LocalWorktreePage({
  params,
}: LocalWorktreePageProps) {
  const { project } = await params;
  const resolved = tryResolveLocalProject(project);
  if (resolved == null) {
    notFound();
  }
  const localSource: LocalViewerSource = {
    project: resolved.id,
    target: { kind: 'worktree' },
  };
  return (
    <div className="flex h-dvh flex-col gap-2">
      <ReviewUI
        initialUrl={`https://github.com/${resolved.repo}`}
        path={`/local/${resolved.id}/worktree`}
        localSource={localSource}
      />
    </div>
  );
}
