'use client';

import { IconSymbolDiffstatFill } from '@pierre/icons';
import { memo, useEffect } from 'react';

import type { CodeViewDiffStats as CodeViewDiffStatsData } from './types';
import { StatItem, StatusRow } from './WorkerPoolStatus';

interface CodeViewDiffStatsProps {
  expanded: boolean;
  onToggle(): void;
  stats: CodeViewDiffStatsData | null;
  streaming: boolean;
}

export const CodeViewDiffStats = memo(function CodeViewDiffStats({
  expanded,
  onToggle,
  stats,
  streaming,
}: CodeViewDiffStatsProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        onToggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onToggle]);

  if (stats == null) {
    return null;
  }

  return (
    <>
      <StatusRow icon={IconSymbolDiffstatFill}>
        <button
          type="button"
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center gap-1 text-sm focus:outline-none"
          aria-expanded={expanded}
        >
          Diff Stats
          <span className="text-muted-foreground/50 hidden md:inline">
            (F2)
          </span>
          {streaming && <StreamingIndicator />}
        </button>
      </StatusRow>
      {expanded && (
        <div className="ml-10 md:mr-1">
          <StatItem
            label="Files"
            value={stats.fileCount}
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
          <StatItem
            label="Lines"
            value={stats.totalLinesOfCode}
            valueClassName="text-foreground font-semibold"
          />
        </div>
      )}
    </>
  );
});

function StreamingIndicator() {
  return (
    <span className="-mr-2 ml-auto rounded-full border border-yellow-500/40 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] leading-none font-medium tracking-wide text-yellow-700 uppercase dark:text-yellow-300">
      streaming
    </span>
  );
}
