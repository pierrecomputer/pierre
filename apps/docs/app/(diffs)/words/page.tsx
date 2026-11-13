import { IconArrowRight, IconBook } from '@pierre/icons';
import Link from 'next/link';

import { WordsBenchmarks } from './WordsBenchmarks';
import { WordsDemo } from './WordsDemo';
import { WordsInstall } from './WordsInstall';
import {
  getInitialWordsUsage,
  WORDS_EXAMPLE_KINDS,
  type WordsExampleKind,
} from './wordsUsage';
import { BetaBadge } from '@/components/BetaBadge';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { docsCodeSnippet } from '@/lib/docsCodeSnippet';
import { pageMetadata } from '@/lib/page-metadata';
import {
  preloadCodeExample,
  type PreloadedCodeExample,
} from '@/lib/preloadCodeExample';
import benchmark from '@/public/words/benchmark.json';

const { base } = benchmark.browser.download;
const baseRendererSavings = Math.round(
  (1 - base.words / base.streamdown) * 100
);

export const metadata = pageMetadata({
  title: 'Words, from Pierre',
  description:
    'Streaming Markdown, rendered directly to HTML in WebAssembly. Try live editing, HTML render hooks, and syntax highlighting.',
  path: '/words',
});

export default async function WordsPage() {
  const usageExamples = Object.fromEntries(
    await Promise.all(
      WORDS_EXAMPLE_KINDS.map(async (kind) => [
        kind,
        await preloadCodeExample(
          docsCodeSnippet(`words-${kind}.tsx`, getInitialWordsUsage(kind), {
            disableFileHeader: false,
          })
        ),
      ])
    )
  ) as Record<WordsExampleKind, PreloadedCodeExample<undefined, undefined>>;

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <Header className="-mb-[1px]" />
      <main className="pb-16 md:pb-24">
        <section className="mb-8 flex flex-col items-center justify-between gap-6 border-b pt-16 pb-8 md:mb-12 md:flex-row md:gap-12 md:pb-12">
          <div className="flex max-w-3xl flex-col gap-3 lg:max-w-4xl">
            <BetaBadge className="self-start" size="large" />
            <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl lg:text-5xl">
              Stream Markdown and text
            </h1>
            <p className="text-md text-muted-foreground mb-0 max-w-[760px] text-pretty lg:text-lg">
              <code>@pierre/words</code> is an incredibly fast and lightweight
              streaming Markdown renderer written in WebAssembly Text. Renders
              directly to HTML, supports GitHub Flavored Markdown, and pairs
              with{' '}
              <Link href="/highlights" className="styled-link">
                <code>@pierre/highlights</code>
              </Link>{' '}
              for syntax highlighting. Includes incremental updates, HTML render
              hooks, and optional token fades. The base React renderer is{' '}
              {baseRendererSavings}% smaller than Streamdown in our gzip
              benchmark.
            </p>
          </div>
          <Button
            variant="link"
            asChild
            size="xl"
            className="text-md h-[auto] self-start rounded-lg px-0 md:mt-auto md:h-[auto] md:text-sm lg:text-lg"
          >
            <Link href="/docs#words">
              <IconBook className="opacity-65" />
              Explore the docs
              <IconArrowRight className="opacity-40" />
            </Link>
          </Button>
        </section>
        <WordsBenchmarks />
        <WordsDemo usageExamples={usageExamples} />
        <WordsInstall />
      </main>
      <Footer />
    </div>
  );
}
