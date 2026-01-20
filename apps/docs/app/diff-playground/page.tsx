'use client';

import { Header } from '@/components/Header';
import { WorkerPoolContext } from '@/components/WorkerPoolContext';

import { AdvancedDiff } from './AdvancedDiff';

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
