import { WordsBenchmarks } from './WordsBenchmarks';
import { WordsDemo } from './WordsDemo';
import { BetaBadge } from '@/components/BetaBadge';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { pageMetadata } from '@/lib/page-metadata';
import benchmark from '@/public/words/benchmark.json';

const baseRenderer = benchmark.footprint.rows.find(({ id }) => id === 'base')!;
const baseRendererSavings = Math.round(
  (1 - baseRenderer.wordsGzipBytes / baseRenderer.streamdownGzipBytes) * 100
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
        <section className="mb-8 border-b pt-16 pb-8 md:mb-12 md:pb-12">
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
        </section>
        <WordsBenchmarks />
        <WordsDemo />
        <section className="mt-16 grid grid-cols-1 gap-6 border-t pt-8 md:grid-cols-3 md:gap-12">
          <div>
            <h2 className="mb-5 border-b pb-4 text-lg font-light">
              Ready as it arrives.
            </h2>
            <p className="text-muted-foreground text-sm">
              Incomplete emphasis and links settle into place while a response
              streams. Finished blocks keep their place.
            </p>
          </div>
          <div>
            <h2 className="mb-5 border-b pb-4 text-lg font-light">
              Your HTML.
            </h2>
            <p className="text-muted-foreground text-sm">
              Customize headings, links, and code blocks with HTML string hooks.
              Keep the rendering path direct.
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
