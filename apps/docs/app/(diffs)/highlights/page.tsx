import highlightsPackageJson from '@pierre/highlights/package.json';
import {
  IconArrowUpRight,
  IconBolt,
  IconBoxTape,
  IconCodeBlock,
} from '@pierre/icons';
import type { Metadata } from 'next';
import Link from 'next/link';

import { BenchmarkBar } from './BenchmarkBar';
import { HighlightsBenchmarks } from './HighlightsBenchmarks';
import { HighlightsCode } from './HighlightsCode';
import { HighlightsHero } from './HighlightsHero';
import { HighlightsInstall } from './HighlightsInstall';
import { HighlightsPlayground } from './HighlightsPlayground';
import { HeadingAnchors } from '@/components/docs/HeadingAnchors';
import { FeatureHeader } from '@/components/FeatureHeader';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { PierreCompanySection } from '@/components/PierreCompanySection';
import { Button } from '@/components/ui/button';
import { pageMetadata } from '@/lib/page-metadata';

const sourceUrl =
  'https://github.com/pierrecomputer/pierre/tree/main/packages/highlights';

export const metadata: Metadata = pageMetadata({
  title: 'Highlights — fast syntax highlighting for code that keeps moving',
  description:
    'A small WebAssembly syntax highlighter for code viewers, editors, and streaming interfaces. 73 built-in languages, themed tokens, and incremental edits.',
  path: '/highlights',
});

// Recorded string-to-HTML results, including encoding and decoding, from
// packages/highlights/benchmark/README.md on September 25, 2026.
const benchmarks = [
  { language: 'CSS', size: '379 KiB', highlights: 309, shiki: 1.25 },
  { language: 'HTML', size: '474 KiB', highlights: 678, shiki: 2.86 },
  { language: 'JSONC', size: '292 KiB', highlights: 894, shiki: 6.04 },
  { language: 'TypeScript', size: '517 KiB', highlights: 321, shiki: 1.09 },
];
const maximumHtmlThroughput = Math.max(
  ...benchmarks.flatMap(({ highlights, shiki }) => [highlights, shiki])
);

const renderExample = `import { codeToHtml } from '@pierre/highlights';
import pierreDark from '@pierre/highlights/themes/pierre-dark';

const bytes = codeToHtml('const answer = 42;', {
  lang: 'ts',
  theme: pierreDark,
});

const html = new TextDecoder().decode(bytes);`;

const streamExample = `import { StreamTokenizer } from '@pierre/highlights';
import pierreDark from '@pierre/highlights/themes/pierre-dark';

const response = await fetch('/source.ts');
if (!response.body) throw new Error('No response body');

const lines = response.body.pipeThrough(
  new StreamTokenizer({ lang: 'ts', theme: pierreDark })
);

for await (const tokens of lines) {
  console.log(tokens); // One completed line at a time.
}`;

const liveExample = `import { LiveTokenizer } from '@pierre/highlights';
import pierreDark from '@pierre/highlights/themes/pierre-dark';

const live = new LiveTokenizer({
  code: 'const answer = 41;', lang: 'ts', theme: pierreDark,
});

try {
  const update = live.applyEdits([{
    range: {
      start: { line: 0, character: 15 },
      end: { line: 0, character: 17 },
    },
    newText: '42',
  }]);
  console.log(update.lineChanges);
} finally {
  live.dispose();
}`;

export default function HighlightsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <Header className="-mb-[1px]" />
      <main>
        <HighlightsHero />
        <HeadingAnchors />
        <section className="space-y-16 pb-8">
          <HighlightsBenchmarks />

          <HighlightsPlayground />

          <section
            className="max-w-3xl space-y-5"
            aria-labelledby="highlights-why"
          >
            <FeatureHeader
              id="highlights-why"
              title="Built for code that keeps changing"
              description="Files open. Diffs load. An agent writes another line. In a code interface, highlighting happens while someone is waiting, and the same code can pass through the highlighter again and again."
            />
            <p className="text-muted-foreground">
              We built Highlights to make that work cheaper. It scans source
              directly in WebAssembly, produces HTML or themed tokens, and
              preserves work across streams and edits. Use it in a browser, on
              Node.js, or in a Cloudflare Worker.
            </p>
          </section>

          <section
            id="html-performance"
            className="scroll-mt-20 space-y-5"
            aria-labelledby="highlights-html-performance"
          >
            <FeatureHeader
              id="highlights-html-performance"
              title="Fast HTML generation"
              description={
                <>
                  Highlight a whole file in one pass. On the 517 KiB TypeScript
                  fixture, Highlights delivers{' '}
                  <strong>294× Shiki’s HTML throughput</strong>, including input
                  encoding and output decoding.
                </>
              }
            />
            <figure className="bg-card overflow-hidden rounded-lg border text-sm tabular-nums">
              <figcaption className="text-muted-foreground border-b px-4 py-3">
                HTML throughput in MiB/s · longer is faster
              </figcaption>
              <div className="divide-y">
                {benchmarks.map(({ language, size, highlights, shiki }) => (
                  <div
                    key={language}
                    className="grid gap-4 px-4 py-5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6"
                  >
                    <div className="font-medium">
                      {language}
                      <span className="text-muted-foreground block text-xs font-normal">
                        {size}
                      </span>
                    </div>
                    <dl
                      aria-label={`${language} throughput in MiB/s`}
                      className="space-y-3"
                    >
                      <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3">
                        <dt className="font-medium">Highlights</dt>
                        <dd className="grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-3">
                          <BenchmarkBar
                            value={highlights}
                            maximum={maximumHtmlThroughput}
                            highlighted
                          />
                          <span className="text-right font-medium">
                            {highlights}
                          </span>
                        </dd>
                      </div>
                      <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3">
                        <dt className="text-muted-foreground">Shiki</dt>
                        <dd className="grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-3">
                          <BenchmarkBar
                            value={shiki}
                            maximum={maximumHtmlThroughput}
                          />
                          <span className="text-muted-foreground text-right">
                            {shiki.toFixed(2)}
                          </span>
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            </figure>
            <p className="text-muted-foreground max-w-3xl text-sm">
              Recorded September 25, 2026 · Bun 1.4.0 · Apple M4 Pro · Shiki
              4.4.1. Median throughput after a 200 ms warm-up, with at least 20
              samples per case. These measurements exclude DOM rendering and do
              not measure highlighting quality. Token boundaries and styles can
              differ. All bars share a linear scale; rainbow bars represent
              Highlights.
            </p>
            <Button variant="outline" asChild>
              <a
                href={`${sourceUrl}/benchmark#html-generation`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Read the benchmark
                <IconArrowUpRight />
              </a>
            </Button>
          </section>

          <section className="space-y-5" aria-labelledby="highlights-engine">
            <FeatureHeader
              id="highlights-engine"
              title="Written in WebAssembly"
              description="Highlights is written by hand in WebAssembly Text (WAT). Each language has a lexer that scans source bytes and emits HTML or token records, with no syntax tree to build along the way."
            />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-12">
              <div>
                <h3 className="text-foreground mb-5 flex flex-col gap-1.5 border-b pb-4 text-lg font-light">
                  <IconBolt className="size-5 text-blue-500" />
                  SIMD scanning
                </h3>
                <p className="text-muted-foreground text-sm">
                  Scanners move through comments, strings, and other long runs
                  in 16-byte steps. Short gaps take a simpler path to avoid
                  unnecessary setup.
                </p>
              </div>
              <div>
                <h3 className="text-foreground mb-5 flex flex-col gap-1.5 border-b pb-4 text-lg font-light">
                  <IconCodeBlock className="size-5 text-purple-500" />
                  Compact output
                </h3>
                <p className="text-muted-foreground text-sm">
                  Adjacent ranges with the same style share a span. The emitter
                  escapes text and writes HTML directly into a reusable buffer,
                  without a JavaScript object for every token.
                </p>
              </div>
              <div>
                <h3 className="text-foreground mb-5 flex flex-col gap-1.5 border-b pb-4 text-lg font-light">
                  <IconBoxTape className="size-5 text-rose-500" />
                  Linear memory
                </h3>
                <p className="text-muted-foreground text-sm">
                  Source, lexer state, and output live in WebAssembly’s linear
                  memory. Request themed JavaScript token objects when your
                  renderer needs them.
                </p>
              </div>
            </div>
            <Button variant="outline" asChild>
              <a
                href="https://github.com/pierrecomputer/pierre/blob/main/packages/highlights/ARCHITECTURE.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                Explore the architecture
                <IconArrowUpRight />
              </a>
            </Button>
          </section>

          <section
            id="get-started"
            className="scroll-mt-20 space-y-5"
            aria-labelledby="highlights-render"
          >
            <FeatureHeader
              id="highlights-render"
              title="Render HTML or themed tokens"
              description={
                <>
                  Generate HTML with <code>codeToHtml()</code>, or use{' '}
                  <code>codeToTokens()</code> for your own renderer. Choose a
                  language and pass a theme. WebAssembly initializes on import;
                  highlighting calls are synchronous once it’s ready.
                </>
              }
            />
            <HighlightsInstall
              gzipBytes={highlightsPackageJson.meta['highlights.wasm.gz']}
            />
            <HighlightsCode code={renderExample} filename="highlight.ts" />
            <p className="text-muted-foreground max-w-3xl text-sm">
              HTML comes back as UTF-8 bytes. Decode it immediately, or copy it
              before the next highlighting call reuses the buffer.
            </p>
          </section>

          <section className="space-y-5" aria-labelledby="highlights-stream">
            <FeatureHeader
              id="highlights-stream"
              title="Stream code as it arrives"
              description={
                <>
                  Feed chunks from a response or an agent into{' '}
                  <code>StreamTokenizer</code>. It emits tokens for each
                  completed line and preserves lexer state between chunks, so a
                  string or comment can continue across chunk boundaries.
                </>
              }
            />
            <HighlightsCode code={streamExample} filename="stream.ts" />
            <p className="text-muted-foreground max-w-3xl text-sm">
              The incomplete final line stays buffered until a newline arrives
              or the stream ends.
            </p>
          </section>

          <section className="space-y-5" aria-labelledby="highlights-live">
            <FeatureHeader
              id="highlights-live"
              title="Update only what changed"
              description={
                <>
                  Use <code>LiveTokenizer</code> to keep a document and its
                  lexer state between edits. It re-tokenizes affected lines
                  until the state matches an unchanged boundary, then reuses the
                  rest.
                </>
              }
            />
            <HighlightsCode code={liveExample} filename="edit.ts" />
            <p className="text-muted-foreground max-w-3xl text-sm">
              For large documents, prioritize the visible range and let
              off-screen work finish in the background.
            </p>
            <Button variant="outline" asChild>
              <Link href="/docs#highlights">Read the API documentation</Link>
            </Button>
          </section>

          <section className="space-y-5" aria-labelledby="highlights-fit">
            <FeatureHeader
              id="highlights-fit"
              title="Built-in languages and themes"
              description="73 built-in languages, from TypeScript and Rust to Markdown and SQL. Embedded languages hand off to their own lexers, including scripts in HTML and supported code fences."
            />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-12">
              <div className="space-y-2">
                <h3 className="mb-5 border-b pb-4 text-lg font-light">
                  Light, dark, and custom themes
                </h3>
                <p className="text-muted-foreground text-sm">
                  Use Pierre’s themes, bundled adaptations from Shiki’s catalog,
                  or your own Zed-compatible theme. Light and dark colors can be
                  emitted together in a single pass.
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="mb-5 border-b pb-4 text-lg font-light">
                  Shiki-compatible token formats
                </h3>
                <p className="text-muted-foreground text-sm">
                  Themed tokens use familiar Shiki-compatible formats.
                  Highlights has its own lexers and theme objects, so it can’t
                  load TextMate grammars and won’t always classify code the same
                  way.
                </p>
              </div>
            </div>
          </section>
        </section>
        <PierreCompanySection />
      </main>
      <Footer />
    </div>
  );
}
