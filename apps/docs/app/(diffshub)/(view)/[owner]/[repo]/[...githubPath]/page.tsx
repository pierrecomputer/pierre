import { redirect } from 'next/navigation';

import { ReviewUI } from '../../../_components/ReviewUI';

// Viewer route that mirrors GitHub paths after `/owner/repo`, letting GitHub
// decide whether the path has a `.diff` or `.patch` response.
export default async function DiffshubViewByGitHubPathPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; githubPath: string[] }>;
}) {
  const { owner, repo, githubPath } = await params;
  if (githubPath.length === 0) {
    redirect('/');
  }
  const url = `https://github.com/${owner}/${repo}/${githubPath.join('/')}`;

  return (
    <div className="flex h-dvh flex-col gap-2 bg-neutral-50 dark:bg-neutral-900">
      <ReviewUI initialUrl={url} />
    </div>
  );
}
