'use client';

import { IconArrowDownRight, IconCommit } from '@/components/icons';
import { FileDiff } from '@pierre/diffs/react';
import type { PreloadFileDiffResult } from '@pierre/diffs/ssr';
import Link from 'next/link';
import { useState } from 'react';

// =============================================================================
// Fake blame data - maps line numbers to commits
// =============================================================================

interface BlameInfo {
  author: string;
  avatar: string;
  message: string;
  date: string;
  hash: string;
}

const DEFAULT_BLAME: BlameInfo = {
  author: 'Jacob',
  avatar: '/avatars/avatar_fat.jpg',
  message: 'Initial project setup with package.json',
  date: '3w',
  hash: 'a1b2c3d',
};

const BLAME_DATA: Array<{ minLine: number; info: BlameInfo }> = [
  {
    minLine: 14,
    info: {
      author: 'Mark',
      avatar: '/avatars/avatar_mdo.jpg',
      message: 'Upgrade to Next.js 15 and React 19',
      date: '1w',
      hash: 'i7j8k9l',
    },
  },
  {
    minLine: 7,
    info: {
      author: 'Amadeus',
      avatar: '/avatars/avatar_amadeus.jpg',
      message: 'Add Turbopack for faster builds',
      date: '2d',
      hash: 'e4f5g6h',
    },
  },
  { minLine: 1, info: DEFAULT_BLAME },
];

function getBlameForLine(lineNumber: number): BlameInfo {
  const entry = BLAME_DATA.find((e) => lineNumber >= e.minLine);
  return entry?.info ?? DEFAULT_BLAME;
}

// =============================================================================
// Main Component
// =============================================================================

interface GitBlameViewProps {
  prerenderedDiff: PreloadFileDiffResult<undefined>;
}

export function GitBlameView({ prerenderedDiff }: GitBlameViewProps) {
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);

  const blame = hoveredLine != null ? getBlameForLine(hoveredLine) : null;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <IconCommit size={20} className="text-orange-400" />
          <h2 className="text-2xl font-medium">Git Blame (GitLens Style)</h2>
        </div>
        <p className="text-muted-foreground">
          Use <code>onLineEnter</code> and <code>onLineLeave</code> to track
          hover state, then render blame info with{' '}
          <code>renderHoverUtility</code>. Displays author, commit message, and
          timestamp - just like GitLens in VS Code.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <FileDiff
          {...prerenderedDiff}
          options={{
            ...prerenderedDiff.options,
            enableHoverUtility: true,
            onLineEnter: ({ lineNumber }) => {
              setHoveredLine(lineNumber);
            },
            onLineLeave: () => {
              setHoveredLine(null);
            },
          }}
          renderHoverUtility={() => {
            if (blame == null) return null;

            return (
              <div
                className="flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-900 py-2 pr-3 pl-2 shadow-xl"
                style={{
                  fontFamily: 'system-ui, sans-serif',
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  marginBottom: 4,
                }}
              >
                <img
                  src={blame.avatar}
                  alt={blame.author}
                  className="h-5 w-5 flex-shrink-0 rounded-full"
                />
                <div className="flex flex-shrink-0 items-center gap-1 text-xs">
                  <span className="font-medium text-neutral-200">
                    {blame.author}
                  </span>
                  <span className="text-neutral-500">·</span>
                  <code className="text-xs text-orange-400">{blame.hash}</code>
                  <span className="text-neutral-500">·</span>
                  <span className="text-neutral-400">{blame.message}</span>
                  <span className="text-neutral-500">·</span>
                  <span className="text-neutral-400">{blame.date}</span>
                </div>
              </div>
            );
          }}
        />
      </div>

      <div className="flex gap-1">
        <IconArrowDownRight className="text-muted-foreground my-[2px] shrink-0 opacity-50" />
        <p className="text-muted-foreground text-sm">
          The <code>onLineEnter</code> callback updates React state with the
          hovered line number. This triggers a re-render, and{' '}
          <code>renderHoverUtility</code> uses that state to look up blame data
          and render an inline tooltip. In a real app, you'd fetch this from
          your git provider's API.
        </p>
      </div>
    </div>
  );
}
