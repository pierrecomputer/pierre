import { WorkerPoolContext } from '@diffs/_components/WorkerPoolContext';
import { redirect } from 'next/navigation';

import { GHViewer } from '../../../../_components/GHViewer';

// Viewer route that mirrors GitHub's URL shape, e.g.
// `/twbs/bootstrap/pull/42369`. Reaching this page means the URL was
// already shaped like a real PR; we still defend against weird `prNumber`
// values (anything that isn't a positive integer) by bouncing home.
export default async function DiffshubViewByPathPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; prNumber: string }>;
}) {
  const { owner, repo, prNumber } = await params;
  if (!/^\d+$/.test(prNumber)) {
    redirect('/');
  }
  const url = `https://github.com/${owner}/${repo}/pull/${prNumber}`;

  return (
    <WorkerPoolContext>
      <div className="flex h-dvh flex-col gap-2 bg-neutral-50 dark:bg-neutral-900">
        <GHViewer initialUrl={url} />
      </div>
    </WorkerPoolContext>
  );
}
