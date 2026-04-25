'use client';

import { WorkerPoolContext } from '@diffs/_components/WorkerPoolContext';

import { GHViewer } from './GHViewer';
import { Header } from '@/components/Header';

export default function AdvancedDiffPage() {
  return (
    <WorkerPoolContext>
      <div className="flex h-dvh flex-col">
        <Header className="mx-0 px-5 md:px-5" />
        <GHViewer />
      </div>
    </WorkerPoolContext>
  );
}
