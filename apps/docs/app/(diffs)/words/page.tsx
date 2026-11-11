import { IconArrowRight, IconBook } from '@pierre/icons';
import Link from 'next/link';

import { WordsBenchmarks } from './WordsBenchmarks';
import { WordsDemo } from './WordsDemo';
import { WordsInstall } from './WordsInstall';
import { AgentSkillMenu } from '@/components/AgentSkillMenu';
import { BetaBadge } from '@/components/BetaBadge';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { pageMetadata } from '@/lib/page-metadata';
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

export default function WordsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <Header className="-mb-[1px]" />
      <main className="pb-16 md:pb-24">
        <section className="mb-8 flex flex-col gap-6 border-b pt-16 pb-8 md:mb-12 md:pb-12">
          <div className="flex max-w-3xl flex-col gap-3 lg:max-w-4xl">
            <BetaBadge className="self-start" size="large" />
            <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl lg:text-5xl">
              Stream words and markdown
            </h1>
            <p className="text-md text-muted-foreground mb-0 max-w-[760px] text-pretty lg:text-lg">
              <code>@pierre/words</code> is a super-fast, lightweight Markdown
              renderer hand-written in WebAssembly Text. Built for streaming
              conversations. Renders directly to HTML, supports GitHub Flavored
              Markdown, and pairs with <code>@pierre/highlights</code> for
              syntax highlighting. Includes incremental updates, HTML render
              hooks, and optional token fades. The base React renderer is{' '}
              {baseRendererSavings}% smaller than Streamdown in our gzip
              benchmark.
            </p>
          </div>
          <div className="flex flex-col gap-3 min-[460px]:flex-row min-[460px]:flex-wrap min-[460px]:items-center min-[460px]:gap-6">
            <WordsInstall />
            <AgentSkillMenu productId="words" />
            <Button
              variant="link"
              asChild
              size="xl"
              className="text-md h-auto self-start rounded-lg px-0 md:text-sm lg:text-lg"
            >
              <Link href="/docs#words">
                <IconBook className="opacity-65" />
                Explore the docs
                <IconArrowRight className="opacity-40" />
              </Link>
            </Button>
          </div>
        </section>
        <WordsBenchmarks />
        <WordsDemo />
        <section className="mt-16 grid grid-cols-1 gap-6 border-t pt-8 md:grid-cols-3 md:gap-12">
          <div>
            <h2 className="mb-5 border-b pb-4 text-lg font-light">
              Ready as it arrives.
            </h2>
            <p className="text-muted-foreground text-sm">
              Unfinished emphasis and links render correctly while a response
              streams. Finished blocks are not rendered again.
            </p>
          </div>
          <div>
            <h2 className="mb-5 border-b pb-4 text-lg font-light">
              Your HTML.
            </h2>
            <p className="text-muted-foreground text-sm">
              Customize headings, links, and code blocks with hooks that take
              and return HTML strings.
            </p>
          </div>
          <div>
            <h2 className="mb-5 border-b pb-4 text-lg font-light">
              A small, capable core.
            </h2>
            <p className="text-muted-foreground text-sm">
              Tables, task lists, and footnotes from a WAT parser. Add Pierre
              Highlights when your words include code.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
