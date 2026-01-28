'use client';

import { AdvancedDiff } from './AdvancedDiff';
import { Header } from '@/components/Header';
import { WorkerPoolContext } from '@/components/WorkerPoolContext';

export default function AdvancedDiffPage() {
  return (
    <WorkerPoolContext>
      <div className="relative mx-auto w-5xl max-w-full px-5">
        <Header />
      </div>
      <div>
        <AdvancedDiff />
      </div>
    </WorkerPoolContext>
  );
}
