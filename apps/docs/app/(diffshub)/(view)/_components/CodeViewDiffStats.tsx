'use client';

import { IconSymbolDiffstatFill } from '@pierre/icons';
import { memo, useEffect, useState } from 'react';

import type { CodeViewDiffStats as CodeViewDiffStatsData } from './types';
import { StatItem, StatusRow } from './WorkerPoolStatus';

interface CodeViewDiffStatsProps {
  stats: CodeViewDiffStatsData | null;
}

export const CodeViewDiffStats = memo(function CodeViewDiffStats({
  stats,
}: CodeViewDiffStatsProps) {
  const [showStats, setShowStats] = useState(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        setShowStats((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (stats == null) {
    return null;
  }

  return (
    <>
      <StatusRow icon={IconSymbolDiffstatFill}>
        <button
          type="button"
          onClick={() => setShowStats((prev) => !prev)}
          className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-sm focus:outline-none"
          aria-expanded={showStats}
        >
          {showStats ? 'Hide' : 'Show'} Diff Stats
          <span className="text-muted-foreground/50">(F2)</span>
        </button>
      </StatusRow>
      {showStats && (
        <div className="mr-2 mb-2 ml-9">
          <StatItem
            label="Files"
            value={stats.fileCount}
            valueClassName="text-foreground font-semibold"
          />
          <StatItem
            label="Lines"
            value={stats.totalLinesOfCode}
            valueClassName="text-foreground font-semibold"
          />
          <StatItem
            label="Additions"
            value={stats.addedLines}
            valueClassName="text-green-600 dark:text-green-400 font-semibold"
          />
          <StatItem
            label="Deletions"
            value={stats.deletedLines}
            valueClassName="text-red-600 dark:text-red-400 font-semibold"
          />
        </div>
      )}
    </>
  );
});
