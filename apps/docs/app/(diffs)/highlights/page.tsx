import { setHighlighter, shikiHighlighter } from '@pierre/diffs';
import { highlightsHighlighter } from '@pierre/diffs/highlights';
import { preloadFile } from '@pierre/diffs/ssr';
import { IconBolt, IconCodeBlock, IconPencil } from '@pierre/icons';
import type { Metadata } from 'next';

import highlightsPackageJson from '../../../../../packages/highlights/package.json';
import { HighlightsHero } from './HighlightsHero';
import { HighlightsPlayground } from './HighlightsPlayground';
import { PLAYGROUND_LANGUAGES } from './languageExamples';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { PierreCompanySection } from '@/components/PierreCompanySection';
import { pageMetadata } from '@/lib/page-metadata';

const description =
  'A tiny, fast code highlighter written by hand in WebAssembly Text, with built-in lexers and Shiki-compatible tokens, HAST, themes, and transformers.';

export const metadata: Metadata = pageMetadata({
  title: 'Highlights — a fast WebAssembly code highlighter',
  description,
  path: '/highlights',
});

export default async function HighlightsPage() {
  const [lang, , contents] = PLAYGROUND_LANGUAGES[0];
  setHighlighter(highlightsHighlighter);
  const playground = await preloadFile({
    file: { name: `source.${lang}`, contents, lang },
    options: {
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      themeType: 'system',
      useTokenTransformer: true,
    },
  }).finally(() => setHighlighter(shikiHighlighter));

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <Header className="-mb-[1px]" />
      <main>
        <HighlightsHero
          gzipBytes={highlightsPackageJson.meta['highlights.wasm.gz']}
        />
        <HighlightsPlayground prerenderedHTML={playground.prerenderedHTML} />
        <section
          aria-labelledby="highlights-features"
          className="space-y-8 pb-16 md:pb-24"
        >
          <div className="space-y-1.5">
            <h2
              id="highlights-features"
              className="text-2xl font-semibold tracking-tight"
            >
              Fast, familiar, and editor-ready.
            </h2>
            <p className="text-muted-foreground max-w-3xl text-pretty">
              Native WebAssembly performance, Shiki-compatible output, and
              incremental tokenization built for editors.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-12">
            <div>
              <h3 className="text-foreground mb-5 flex flex-col gap-1.5 border-b pb-4 text-lg font-light">
                <IconBolt className="size-5 text-green-500" />
                Native performance
              </h3>
              <dl className="space-y-5">
                <div>
                  <dt className="text-sm font-medium">One-pass lexers</dt>
                  <dd className="text-muted-foreground mt-0.5 text-sm text-pretty">
                    Hand-written Wasm lexers emit HTML or token records
                    directly, with no AST or grammar runtime.
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium">Zero-copy output</dt>
                  <dd className="text-muted-foreground mt-0.5 text-sm text-pretty">
                    <code>codeToHtml()</code> returns a view into WebAssembly
                    memory, ready for a response, file, or decoder.
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium">SIMD scans</dt>
                  <dd className="text-muted-foreground mt-0.5 text-sm text-pretty">
                    Hot paths read 16 bytes per step, and equal styles share
                    spans across whitespace.
                  </dd>
                </div>
              </dl>
            </div>

            <div>
              <h3 className="text-foreground mb-5 flex flex-col gap-1.5 border-b pb-4 text-lg font-light">
                <IconCodeBlock className="size-5 text-purple-500" />
                Shiki compatibility
              </h3>
              <dl className="space-y-5">
                <div>
                  <dt className="text-sm font-medium">Familiar APIs</dt>
                  <dd className="text-muted-foreground mt-0.5 text-sm text-pretty">
                    Use <code>codeToHtml()</code>, <code>codeToTokens()</code>,
                    and <code>codeToHast()</code> in familiar highlighting
                    workflows.
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium">Tokens & HAST</dt>
                  <dd className="text-muted-foreground mt-0.5 text-sm text-pretty">
                    Render Shiki-compatible themed tokens or HAST with
                    decorations and transformers.
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium">Themes included</dt>
                  <dd className="text-muted-foreground mt-0.5 text-sm text-pretty">
                    Use bundled Zed themes or supply your own light and dark
                    theme objects.
                  </dd>
                </div>
              </dl>
            </div>

            <div>
              <h3 className="text-foreground mb-5 flex flex-col gap-1.5 border-b pb-4 text-lg font-light">
                <IconPencil className="size-5 text-blue-500" />
                Editor friendly
              </h3>
              <dl className="space-y-5">
                <div>
                  <dt className="text-sm font-medium">Incremental edits</dt>
                  <dd className="text-muted-foreground mt-0.5 text-sm text-pretty">
                    <code>LiveTokenizer</code> re-tokenizes only lines whose
                    text or lexer state changed.
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium">
                    Visible-range rendering
                  </dt>
                  <dd className="text-muted-foreground mt-0.5 text-sm text-pretty">
                    Bound synchronous work to the viewport while off-screen
                    lines converge in the background.
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium">Precise updates</dt>
                  <dd className="text-muted-foreground mt-0.5 text-sm text-pretty">
                    Every edit reports exactly which lines changed, leaving
                    untouched rows alone.
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>
        <PierreCompanySection />
      </main>
      <Footer />
    </div>
  );
}
