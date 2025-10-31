'use client';

import { IconCiWarningFill } from '@/components/icons';

export function OverviewWarning() {
  return (
    <p className="text-md flex gap-2 rounded-md border border-cyan-500/20 bg-cyan-500/10 px-5 py-4 text-cyan-600 dark:text-cyan-300">
      <IconCiWarningFill className="mt-[6px]" />
      Precision Diffs is in early active development—APIs are subject to change.
    </p>
  );
}
