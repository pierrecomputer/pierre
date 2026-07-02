import { preloadFileDiff } from '@pierre/diffs/ssr';
import { Suspense } from 'react';

import { WorkerPoolContext } from '../_components/WorkerPoolContext';
import { PLAYGROUND_DIFF } from './constants';
import { PlaygroundClient } from './PlaygroundClient';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';

export default async function PlaygroundPage() {
  const prerenderedDiff = await preloadFileDiff(PLAYGROUND_DIFF);

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <Header />
      <main className="py-8">
        <Suspense
          fallback={
            <div className="text-muted-foreground py-8 text-center">
              Loading playground…
            </div>
          }
        >
          <WorkerPoolContext>
            <PlaygroundClient prerenderedDiff={prerenderedDiff} />
          </WorkerPoolContext>
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
