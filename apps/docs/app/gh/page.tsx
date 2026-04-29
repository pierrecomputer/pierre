'use client';

import { WorkerPoolContext } from '@diffs/_components/WorkerPoolContext';

import { GHViewer } from './GHViewer';

export default function AdvancedDiffPage() {
  return (
    <WorkerPoolContext>
      <div className="flex h-dvh flex-col gap-2 bg-neutral-50 dark:bg-neutral-900">
        <GHViewer />
      </div>
    </WorkerPoolContext>
  );
}
