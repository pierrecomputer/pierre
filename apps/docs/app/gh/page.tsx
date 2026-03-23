'use client';

import { AdvancedDiff } from './AdvancedDiff';
import { Header } from '@/components/Header';
import { WorkerPoolContext } from '@/components/WorkerPoolContext';

export default function AdvancedDiffPage() {
  return (
    <WorkerPoolContext>
      <div className="flex h-dvh flex-col">
        <Header className="px-5" />
        <AdvancedDiff />
      </div>
    </WorkerPoolContext>
  );
}
