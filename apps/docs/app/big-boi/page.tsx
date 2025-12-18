'use client';

import { Header } from '@/components/Header';
import { WorkerPoolContext } from '@/components/WorkerPoolContext';

import { BigBoiDiff } from './BigBoiDiff';

export default function BigBoiPage() {
  return (
    <WorkerPoolContext>
      <div className="relative mx-auto w-5xl max-w-full px-5">
        <Header />
      </div>
      <div>
        <BigBoiDiff />
      </div>
    </WorkerPoolContext>
  );
}
