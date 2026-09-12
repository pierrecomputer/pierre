# Highlights, from Pierre

`@pierre/highlights` is a syntax highlighter written in WebAssembly Text (WAT),
with built-in lexers for 67 languages and Zed-compatible themes. It generates
HTML or themed tokens and supports streaming input and incremental edits.

Try it live in the [playground](https://diffs.com/highlights).

## Performance

Lexers emit HTML or binary token records without an AST. Hot scans process 16
bytes at a time with SIMD, and equal HTML styles share spans across whitespace.
HTML output is a view of WebAssembly memory; themed token objects are built in
JavaScript. See the [benchmarks](./benchmark/README.md) for measured throughput,
sizes, and methodology.

## Installation

```bash
pnpm add @pierre/highlights
```

Highlights runs in Node.js, browsers, and Cloudflare Workers. Conditional
exports select the right WebAssembly loader.

## HTML generation

```js
import { codeToHtml } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

const html = codeToHtml("console.log('Hello world!')", {
  lang: 'js',
  theme: pierreDark,
});
const markup = new TextDecoder().decode(html);
// <pre class="highlights" style="background-color:#0a0a0a;color:#fafafa"><code>...</code></pre>
```

`codeToHtml` accepts `string`, `Uint8Array`, or `ArrayBuffer`. It returns a
`Uint8Array` view containing a `<pre class="highlights">` fragment. Byte input
is UTF-8. The view is valid until the next highlighting or tokenization call on
the same highlighter. Decode it immediately, or call `html.slice()` to retain
the bytes.

Language names and aliases are case-insensitive. Highlighting rejects
unsupported names; `isSupportedLanguage(name)` checks support. Use
`lang: 'text'` for plain text.

## Token generation

`codeToTokens` accepts the same input types and returns Shiki-compatible themed
tokens, grouped by line. Token offsets are absolute UTF-16 indices in the input.

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

With `themes`, `light` supplies the default inline color. Set `defaultColor` to
another theme key, `false` for CSS variables only, or `'light-dark()'` to
combine the `light` and `dark` themes. `tokenizeMaxLineLength` emits one
unthemed token for lines at or above the limit; `0` or omission disables the
limit.

## Streaming mode

`StreamTokenizer` owns an isolated Wasm instance and preserves lexer state
across chunks. `pushCode` accepts strings and returns completed lines; the
unfinished line stays buffered until a newline or `end()`. Offsets are relative
to the full stream.

```js
import { StreamTokenizer } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

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

`LiveTokenizer` stores the document, line tokens, and lexer states in Wasm.
Edits re-tokenize affected lines until lexer state converges with the retained
state. `getLineText` and `getText` read back the exact document.

```ts
import { LiveTokenizer } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

const live = new LiveTokenizer({
  lang: 'ts',
  theme: pierreDark,
  code: 'const a = 1;\nconst b = 2;',
});
try {
  const update = live.applyEdits([
    {
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 11 },
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

Edit positions are zero-based UTF-16 coordinates in the pre-edit document;
ranges exclude the end. `lineChanges` contains coalesced ranges of changed or
re-tokenized lines. `getLineTokens` returns offsets relative to its line.

Pass `renderRange: [startLine, endLine]` to prioritize a viewport. Synchronous
work processes earlier dirty lines to establish its lexer state and stops once
the cursor reaches or passes `endLine`. In-range tokens appear in
`update.lines`; completed off-range lines and subsequent background slices are
delivered through `onDeferTokenize`. Without a range, updates run to convergence
and `update.lines` is empty.

`onDeferTokenize` can run synchronously, including before the constructor
returns. Its callback must not depend on the variable receiving the instance.
Use `pause`, `resume`, and `flush` to control deferred work, and `dispose` when
finished.

## Themes

Pass a theme object or a Zed `ThemeFamily`; families resolve to `themes[0]`.
Import a family member directly to select another theme. String theme IDs are
not accepted. See the [bundled themes](./themes/README.md) for imports and the
full catalog.

```ts
import type { Theme } from '@pierre/highlights';

const theme = {
  name: 'Example',
  appearance: 'dark',
  style: {
    'editor.background': '#0a0a0a',
    'editor.foreground': '#fafafa',
    syntax: {
      comment: { color: '#737373', font_style: 'italic' },
      string: '#5ecc71',
      'keyword.declaration': { color: '#ff678d', font_weight: 600 },
    },
  },
} satisfies Theme;
```

Colors accept `#rgb`, `#rgba`, `#rrggbb`, and `#rrggbbaa`. Syntax scopes inherit
colors from the nearest dot-separated parent, then use the foreground for
font-only styles. `editor.background` falls back to `background`;
`editor.foreground` falls back to `text`, then `foreground`. Theme objects are
cached by identity; create a new object when changing a theme.

### CSS variables

Use the `cssVariables` theme to set code colors in CSS.

```js
import { codeToHtml } from '@pierre/highlights';
import { cssVariables } from '@pierre/highlights/themes';

const html = codeToHtml('const a = 1', { lang: 'js', theme: cssVariables });
const markup = new TextDecoder().decode(html);
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

CSS-variable mode ignores `font_style` and `font_weight`; its custom properties
control colors only.

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
