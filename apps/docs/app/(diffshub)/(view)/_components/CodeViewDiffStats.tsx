'use client';

import { memo } from 'react';

import type { CodeViewDiffStats as CodeViewDiffStatsData } from './types';
import { cn } from '@/lib/utils';

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

interface CodeViewDiffStatsProps {
  className?: string;
  stats: CodeViewDiffStatsData | null;
}

export const CodeViewDiffStats = memo(function CodeViewDiffStats({
  className,
  stats,
}: CodeViewDiffStatsProps) {
  if (stats == null) {
    return null;
  }

  return (
    <section
      aria-label="Diff stats"
      className={cn('border-border mx-2 border-t p-2 text-sm', className)}
    >
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-neutral-100 p-2 px-2.5 dark:bg-neutral-800/70">
        <StatItem label="Files" value={stats.fileCount} />
        <StatItem label="LOC" value={stats.totalLinesOfCode} />
        <StatItem
          label="Added"
          value={stats.addedLines}
          valueClassName="text-green-600 dark:text-green-400"
        />
        <StatItem
          label="Deleted"
          value={stats.deletedLines}
          valueClassName="text-red-600 dark:text-red-400"
        />
      </div>
    </section>
  );
});

interface StatItemProps {
  label: string;
  value: number;
  valueClassName?: string;
}

function StatItem({ label, value, valueClassName }: StatItemProps) {
  return (
    <div className="bg-background/70 min-w-0 rounded-md px-2 py-1.5">
      <div className="text-muted-foreground text-[11px] leading-none font-medium tracking-wide uppercase">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 truncate text-sm leading-none font-semibold tabular-nums',
          valueClassName
        )}
        style={{ fontFamily: 'var(--font-berkeley-mono)' }}
      >
        {NUMBER_FORMATTER.format(value)}
      </div>
    </div>
  );
}
