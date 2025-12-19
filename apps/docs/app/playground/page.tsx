import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { preloadFileDiff } from '@pierre/diffs/ssr';

import { PlaygroundClient } from './PlaygroundClient';
import { PLAYGROUND_DIFF } from './constants';

export default async function PlaygroundPage() {
  const prerenderedDiff = await preloadFileDiff(PLAYGROUND_DIFF);

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <Header />
      <main className="py-8">
        <PlaygroundClient prerenderedDiff={prerenderedDiff} />
      </main>
      <Footer />
    </div>
  );
}
