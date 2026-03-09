'use client';

import { AdvancedDiff } from './AdvancedDiff';
import { Header } from '@/components/Header';
import { WorkerPoolContext } from '@/components/WorkerPoolContext';

export default function AdvancedDiffPage() {
  return (
    <WorkerPoolContext>
      <Header className="px-5" />
      <AdvancedDiff />
    </WorkerPoolContext>
  );
}
