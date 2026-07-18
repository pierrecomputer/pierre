import { preloadFileDiff } from '@pierre/diffs/ssr';
import { Suspense } from 'react';

import { WorkerPoolContext } from '../_components/WorkerPoolContext';
import { getPlaygroundPreloadOptions } from './constants';
import { PlaygroundClient } from './PlaygroundClient';
import { parsePlaygroundSearchParams } from './searchParams';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';

type PlaygroundSearchParams = Record<string, string | string[] | undefined>;

export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams?: Promise<PlaygroundSearchParams> | PlaygroundSearchParams;
}) {
  const params = (await searchParams) ?? {};
  // Server and client parse the querystring with the same parser, so the
  // prerendered markup matches the client's first render for any
  // parameterized load, not just the defaults.
  const urlState = parsePlaygroundSearchParams((key) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? null;
  });
  const prerenderedDiff = await preloadFileDiff(
    getPlaygroundPreloadOptions(urlState)
  );

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
