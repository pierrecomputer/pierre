# Highlights, from Pierre

`@pierre/highlights` is a fast code highlighter written by hand in WebAssembly
Text (WAT).

- **Lightweight**: 69.1 KiB (gzipped Wasm) for 67 languages
- **Fast**: 120–582× Shiki's throughput in the latest
  [HTML benchmark](./benchmark/README.md#html-generation)
- Includes 67 built-in language lexers, no external grammar definitions needed
- Compatible with Zed's theme format

Try it live in the [playground](https://diffs.com/highlights).

## Why it's tiny and fast

- **One pass.** Each lexer emits HTML or tokens directly; no AST.
- **Zero-copy output.** Results view WebAssembly memory directly.
- **SIMD scans.** Hot paths read 16 bytes per step.
- **Merged spans.** Equal styles share one `<span>` across whitespace.
- **Hand-written WAT.** No C or Rust compiler overhead.

## Installation

```bash
npm install @pierre/highlights
```

Highlights runs in Node.js, browsers, and Cloudflare Workers. Conditional
exports select the right WebAssembly loader.

## HTML generation

`codeToHtml` is the main function for HTML generation.

```js
import { codeToHtml } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

const html = codeToHtml("console.log('Hello world!')", {
  lang: 'js',
  theme: pierreDark,
});
new TextDecoder().decode(html);
// <pre class="highlights" style="background-color:#0a0a0a;color:#fafafa"><code>...</code></pre>
```

`codeToHtml` accepts `string`, `Uint8Array`, or `ArrayBuffer`. It returns a
`Uint8Array` view containing a self-contained `<pre class="highlights">`
fragment. The view is valid until the next call. Send it to a `Response` or
file, or decode it with `TextDecoder`.

## Token generation

`codeToTokens` returns Shiki-compatible themed tokens. WebAssembly emits
line-aware UTF-16 style records; JavaScript builds the token objects.

```js
import { codeToTokens } from '@pierre/highlights';
import { pierreDark, pierreLight } from '@pierre/highlights/themes';

const { tokens } = codeToTokens('const a = 1', {
  lang: 'ts',
  themes: {
    dark: pierreDark,
    light: pierreLight,
  },
});
// Use `theme: pierreDark` instead of `themes` for single-theme tokens.
```

## Streaming mode

Use `StreamTokenizer` for streaming. It owns a Wasm instance and text buffer.
Streams preserve lexer state for every language and scan only newly completed
chunks:

```js
import { StreamTokenizer } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

// SSR streaming: push chunks, get newly completed lines of tokens
const stream = new StreamTokenizer({ lang: 'ts', theme: pierreDark });
const lines = [];
try {
  for await (const chunk of chunks) lines.push(...stream.pushCode(chunk));
  lines.push(...stream.end());
} finally {
  stream.dispose();
}
```

## Edit mode

`LiveTokenizer` keeps the document, per-line token records, and interned lexer
states in Wasm, and doubles as the document model: `getLineText`/`getText` read
back the exact document.

```ts
import { LiveTokenizer } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

// editing: apply batched UTF-16 range edits; only lines whose lexer state
// changed are re-tokenized, and the update lists exactly those lines
const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code });
try {
  const update = live.applyEdits([
    {
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 9 },
      },
      newText: 'let b = 2',
    },
  ]);
  for (const change of update.lineChanges) {
    for (let i = change.newStartLine; i < change.newEndLine; i++) {
      const { tokens, bracketIgnoredRanges } = live.getLineTokens(i);
    }
  }
} finally {
  live.dispose();
}
```

## Themes

Highlights uses Zed's theme format:

```ts
interface ThemeSyntaxSettings {
  color?: string;
  font_style?: 'italic' | 'normal';
  font_weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
}

interface Theme {
  name: string;
  appearance: 'dark' | 'light';
  style: {
    background?: string;
    foreground?: string;
    text?: string;
    'editor.background'?: string;
    'editor.foreground'?: string;
    syntax?: Record<string, string | ThemeSyntaxSettings>;
  };
  cssVariables?: true;
}
```

Highlights bundles themes matching all 65 IDs, names, and appearances in Shiki's
catalog, plus eight Pierre themes, and ships further variants through the
`@pierre/highlights/themes/<name>` subpaths. See the
[theme list](./themes/README.md).

### CSS variables

Use the `cssVariables` theme to set code colors in CSS.

```js
import { codeToHtml } from '@pierre/highlights';
import { cssVariables } from '@pierre/highlights/themes';

const html = codeToHtml('const a = 1', { lang: 'js', theme: cssVariables });
new TextDecoder().decode(html);
// <pre class="highlights" style="background-color:var(--hls-background);color:var(--hls-foreground);"><code><span style="color:var(--hls-keyword-declaration)">const </span>...
```

Define the variables in your CSS:

```css
:root {
  --hls-background: #0a0a0a;
  --hls-foreground: #fafafa;
  --hls-comment: #737373;
  --hls-comment-doc: #737373;
  --hls-string: #5ecc71;
  --hls-keyword-declaration: #ff678d;
  /* Set other token variables as needed. */
}
```

Generate declarations from any Zed theme with `toCSS`:

```js
import { toCSS, pierreDark } from '@pierre/highlights/themes';

toCSS(pierreDark);
// --hls-background: #0a0a0a;--hls-foreground: #fafafa;--hls-comment: #737373;--hls-comment-doc: #737373;...
```

> [!IMPORTANT] CSS-variable mode ignores `font_style` and `font_weight`. Its
> custom properties control all emitted colors.

## Development

```bash
moonx highlights:build        # compile WAT (wabt + binaryen) and TS glue (tsdown) into dist/
moonx highlights:test         # run tests (bun test)
moonx highlights:bench        # run benchmarks
moonx highlights:bench-live   # benchmark incremental editor tokenization
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for internals.

## License

Apache-2.0
