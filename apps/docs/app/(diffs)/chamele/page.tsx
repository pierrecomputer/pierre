import { setHighlighter, shikiHighlighter } from '@pierre/diffs';
import { chameleHighlighter } from '@pierre/diffs/chamele';
import { File, type FileContents, type FileOptions } from '@pierre/diffs/react';
import { preloadFile } from '@pierre/diffs/ssr';
import type { Metadata } from 'next';

import chamelePackageJson from '../../../../../packages/chamele/package.json';
import { ChameleHero } from './ChameleHero';
import { ChamelePlayground } from './ChamelePlayground';
import { PLAYGROUND_LANGUAGES } from './languageExamples';
import { HeadingAnchors } from '@/components/docs/HeadingAnchors';
import { FeatureHeader } from '@/components/FeatureHeader';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { PierreCompanySection } from '@/components/PierreCompanySection';
import { pageMetadata } from '@/lib/page-metadata';

const description =
  'A tiny, fast code highlighter written by hand in WebAssembly Text, with built-in lexers and Shiki-compatible tokens, HAST, themes, and transformers.';

export const metadata: Metadata = pageMetadata({
  title: 'Chamele — a fast WebAssembly code highlighter',
  description,
  path: '/chamele',
});

const EXAMPLE_OPTIONS = {
  disableFileHeader: true,
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  themeType: 'system',
  useTokenTransformer: true,
} as const satisfies FileOptions<undefined>;

const BASIC_EXAMPLE = {
  name: 'basic.ts',
  contents: `import { codeToHtml } from '@pierre/chamele';
import { pierreDark } from '@pierre/chamele/themes';

const html = codeToHtml("console.log('Hello world!')", {
  lang: 'js',
  theme: pierreDark,
});

return new Response(html, {
  headers: { 'content-type': 'text/html; charset=utf-8' },
});`,
} satisfies FileContents;

const TOKENS_AND_HAST_EXAMPLE = {
  name: 'tokens.ts',
  contents: `import { codeToHast, codeToTokens } from '@pierre/chamele';
import { pierreDark } from '@pierre/chamele/themes';

const source = 'const answer = 42;';
const options = { lang: 'ts', theme: pierreDark } as const;

const { tokens, fg, bg } = codeToTokens(source, options);
// tokens: ThemedToken[][]

const root = codeToHast(source, {
  ...options,
  decorations: [{
    start: 6,
    end: 12,
    properties: { class: 'highlighted-word' },
  }],
});
// root: HastRoot`,
} satisfies FileContents;

const STREAM_EXAMPLE = {
  name: 'stream.ts',
  contents: `import { TokenizeStream } from '@pierre/chamele';
import { pierreDark } from '@pierre/chamele/themes';

const stream = new TokenizeStream({
  lang: 'tsx',
  theme: pierreDark,
});

try {
  for await (const chunk of chunks) {
    for (const line of stream.pushCode(chunk)) render(line);
  }
  for (const line of stream.end()) render(line);
} finally {
  stream.dispose();
}`,
} satisfies FileContents;

const LIVE_EXAMPLE = {
  name: 'live.ts',
  contents: `import { LiveTokenizer } from '@pierre/chamele';
import { pierreDark } from '@pierre/chamele/themes';

const document = new LiveTokenizer({
  code,
  lang: 'tsx',
  theme: pierreDark,
  renderRange: [0, 100],
});

const update = document.applyEdits(edits);
for (const line of update.lines) render(line);

document.dispose();`,
} satisfies FileContents;

function CodePreview({
  file,
  prerenderedHTML,
}: {
  file: FileContents;
  prerenderedHTML: string;
}) {
  return (
    <File
      file={file}
      className="overflow-hidden rounded-lg border"
      options={EXAMPLE_OPTIONS}
      prerenderedHTML={prerenderedHTML}
      disableWorkerPool
    />
  );
}

export default async function ChamelePage() {
  const [lang, , contents] = PLAYGROUND_LANGUAGES[0];
  const [playground, basic, tokensAndHast, stream, live] = await (async () => {
    setHighlighter(chameleHighlighter);
    try {
      return await Promise.all([
        preloadFile({
          file: { name: `source.${lang}`, contents, lang },
          options: {
            theme: { dark: 'pierre-dark', light: 'pierre-light' },
            themeType: 'system',
            useTokenTransformer: true,
          },
        }),
        preloadFile({ file: BASIC_EXAMPLE, options: EXAMPLE_OPTIONS }),
        preloadFile({
          file: TOKENS_AND_HAST_EXAMPLE,
          options: EXAMPLE_OPTIONS,
        }),
        preloadFile({ file: STREAM_EXAMPLE, options: EXAMPLE_OPTIONS }),
        preloadFile({ file: LIVE_EXAMPLE, options: EXAMPLE_OPTIONS }),
      ]);
    } finally {
      setHighlighter(shikiHighlighter);
    }
  })();

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <Header className="-mb-[1px]" />
      <main>
        <ChameleHero gzipBytes={chamelePackageJson.meta['chamele.wasm.gz']} />
        <ChamelePlayground prerenderedHTML={playground.prerenderedHTML} />
        <HeadingAnchors />

        <section className="space-y-16 pb-8">
          <div className="space-y-5">
            <FeatureHeader
              id="one-pass"
              title="Highlight in one pass"
              description={
                <>
                  Chamele&apos;s hand-written lexers emit HTML or tokens
                  directly from WebAssembly—no AST and no grammar downloads.{' '}
                  <code>codeToHtml()</code> accepts strings or bytes and returns
                  a <code>Uint8Array</code> ready for a response, file, or
                  decoder.
                </>
              }
            />
            <CodePreview
              file={BASIC_EXAMPLE}
              prerenderedHTML={basic.prerenderedHTML}
            />
          </div>

          <div className="space-y-5">
            <FeatureHeader
              id="tokens-and-hast"
              title="Tokens and HAST, ready to render"
              description={
                <>
                  <code>codeToTokens()</code> returns Shiki-compatible themed
                  tokens for custom renderers. <code>codeToHast()</code> builds
                  a standard syntax tree and accepts decorations and Shiki-style
                  transformers when you need to shape the markup.
                </>
              }
            />
            <CodePreview
              file={TOKENS_AND_HAST_EXAMPLE}
              prerenderedHTML={tokensAndHast.prerenderedHTML}
            />
          </div>

          <div className="space-y-5">
            <FeatureHeader
              id="streams"
              title="Streaming without buffering"
              description={
                <>
                  <code>TokenizeStream</code> preserves lexer state between
                  chunks and returns completed lines as they arrive. Highlight
                  generated output or streamed files without buffering the whole
                  document.
                </>
              }
            />
            <CodePreview
              file={STREAM_EXAMPLE}
              prerenderedHTML={stream.prerenderedHTML}
            />
          </div>

          <div className="space-y-5">
            <FeatureHeader
              id="editor-friendly"
              title="Editor friendly"
              description={
                <>
                  <code>LiveTokenizer</code> keeps an editable document in Wasm
                  and re-tokenizes only the lines affected by each edit. Bound
                  synchronous work to the visible range while the rest converges
                  in the background.
                </>
              }
            />
            <CodePreview
              file={LIVE_EXAMPLE}
              prerenderedHTML={live.prerenderedHTML}
            />
          </div>
        </section>

        <PierreCompanySection />
      </main>
      <Footer />
    </div>
  );
}
