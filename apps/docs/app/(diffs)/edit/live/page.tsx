import type { Metadata } from 'next';

import { WorkerPoolContext } from '../../_components/WorkerPoolContext';
import { AgentUi } from '../../_home/AgentUi';
import { preloadAuiPrerenderedDiffs } from '../../_home/preloadAuiDiffs';

const title = 'Live editor — Pierre Diffs';
const description =
  'A fullscreen, in-browser agent editing session: review and edit changed files with @pierre/diffs and navigate the change tree on the left, powered by @pierre/trees.';

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description },
  twitter: { card: 'summary_large_image', title, description },
};

// The standalone fullscreen counterpart to the homepage's windowed agent demo.
// Renders nothing but the AgentUi filling the viewport (no header/footer), so
// the windowed card's green "zoom" control can morph straight into it via the
// shared `aui-window` ViewTransition. Diffs are prerendered here too so the
// editor paints highlighted before the client worker pool spins up.
export default async function LiveEditorRoute() {
  const prerenderedDiffs = await preloadAuiPrerenderedDiffs();
  return (
    <WorkerPoolContext>
      <AgentUi variant="fullscreen" prerenderedDiffs={prerenderedDiffs} />
    </WorkerPoolContext>
  );
}
