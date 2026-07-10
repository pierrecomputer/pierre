import Link from 'next/link';

import { AgentUi } from './AgentUi';
import { FeatureHeader } from '@/components/FeatureHeader';

interface AgentDemoSectionProps {
  prerenderedDiffs: Record<string, string>;
}

export function AgentDemoSection({ prerenderedDiffs }: AgentDemoSectionProps) {
  return (
    <div className="space-y-5">
      <FeatureHeader
        id="edit"
        isBeta
        title="Edit diffs and code"
        description={
          <>
            Enable edit mode in any <code>File</code> or <code>FileDiff</code>{' '}
            component with the <code>EditProvider</code>. Includes support for
            selection management, auto-indention, undo history, find-in-file,
            lint markers, and more. Pairs nicely with <code>@pierre/trees</code>{' '}
            for <abbr title="Agentic User Interface">AUI</abbr> style
            experiences.{' '}
            <Link href="/edit" className="inline-link">
              Learn more about edit mode.
            </Link>
          </>
        }
      />

      <AgentUi prerenderedDiffs={prerenderedDiffs} />
    </div>
  );
}
