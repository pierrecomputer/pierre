import type { Metadata } from 'next';

import { LocalProjectsPanel } from '@/components/LocalProjectsPanel';
import { SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: `Local projects — ${SITE_NAME}`,
  robots: { index: false, follow: false },
};

// Index of the locally configured projects and their open PRs. The panel
// fetches /api/local/projects + /api/local/prs, which run gh on the server.
export default function LocalIndexPage() {
  return (
    <div className="flex min-h-[100svh] flex-col items-center justify-center px-6 py-12">
      <div className="w-2xl max-w-[100vw] space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          Local projects
        </h2>
        <LocalProjectsPanel showEmptyHint />
      </div>
    </div>
  );
}
