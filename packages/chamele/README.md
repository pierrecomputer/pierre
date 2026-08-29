# Chamele, from Pierre

`@pierre/chamele` is a fast code highlighter written by hand in WebAssembly Text
(WAT).

- **Lightweight**: 28KB (gzipped wasm) for 29 languages
- **Fast**: 91–668× faster than Shiki in the latest
  [benchmark](./benchmark/README.md)
- Built-in language lexers, no external grammar definitions needed
- Compatible with Zed's theme format

Try it live in the [playground](https://chamele-playground.wat-labs.com).

## Why it's tiny and fast

- **One pass.** Each lexer emits HTML or tokens directly; no AST.
- **Zero-copy output.** Results view WebAssembly memory directly.
- **SIMD scans.** Hot paths read 16 bytes per step.
- **Merged spans.** Equal styles share one `<span>` across whitespace.
- **Hand-written WAT.** No C or Rust compiler overhead.

## Usage

```bash
npm install @pierre/chamele
```

chamele runs in Node.js, browsers, and Cloudflare Workers. Conditional exports
select the right WebAssembly loader.

```js
import { codeToHtml } from '@pierre/chamele';
import { pierreDark } from '@pierre/chamele/themes';

const html = codeToHtml("console.log('Hello world!')", {
  lang: 'js',
  theme: pierreDark,
});
new TextDecoder().decode(html);
// <pre class="chamele" style="background-color:#0a0a0a;color:#fafafa"><code>...</code></pre>
```

`codeToHtml` accepts `string`, `Uint8Array`, or `ArrayBuffer`. It returns a
`Uint8Array` view containing a self-contained `<pre class="chamele">` fragment.
The view is valid until the next call. Send it to a `Response` or file, or
decode it with `TextDecoder`.

## Tokens

`codeToTokens` returns Shiki-compatible themed tokens, and `codeToHast` returns
a HAST tree. For `codeToTokens`, WebAssembly emits line-aware UTF-16 style
records and JavaScript builds the token objects directly.

```js
import { codeToTokens, codeToHast } from '@pierre/chamele';

const { tokens } = codeToTokens('const a = 1', {
  lang: 'ts',
  theme: pierreDark,
});
// [[{ content: 'const ', offset: 0, color: '#ff678d', fontStyle: 0 }, ...]]
const root = codeToHast('const a = 1', { lang: 'ts', theme: pierreDark });
// { type: 'root', children: [{ tagName: 'pre', ... }] }
```

Pass `theme` for one theme or `themes` for multiple color schemes.
`tokenizeMaxLineLength` collapses long lines into one unthemed token.
`codeToHast` also accepts Shiki-style `transformers` and `decorations`.

Use `TokenizeStream` for streaming and `LiveTokenizer` for line edits. Each owns
a Wasm instance and text buffer:

```js
import { TokenizeStream, LiveTokenizer } from '@pierre/chamele';

// SSR streaming: push chunks, get newly completed lines of tokens
const stream = new TokenizeStream({ lang: 'ts', theme: pierreDark });
const lines = [];
for await (const chunk of chunks) lines.push(...stream.pushCode(chunk));
lines.push(...stream.end());

// editing: update one line, get its tokens and string/comment/regex ranges
const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code });
const { tokens, bracketIgnoredRanges } = live.tokenizeLine(1, 'let b = 2');
```

## Themes

chamele uses Zed's theme format:

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

chamele bundles 69 community themes. See the [theme list](./themes/README.md).

### CSS variables

Use the `cssVariables` theme to set code colors in CSS.

```js
import { codeToHtml } from 'chamele';
import { cssVariables } from 'chamele/themes';

const html = codeToHtml('const a = 1', { lang: 'js', theme: cssVariables });
new TextDecoder().decode(html);
// <pre class="chamele" style="background-color:var(--cha-background);color:var(--cha-foreground);"><code><span style="color:var(--cha-keyword-declaration)">const </span>...
```

Define the variables in your CSS:

```css
:root {
  --cha-background: #0a0a0a;
  --cha-foreground: #fafafa;
  --cha-comment: #737373;
  --cha-comment-doc: #737373;
  --cha-string: #5ecc71;
  --cha-keyword-declaration: #ff678d;
  ...
}
```

Generate declarations from any Zed theme with `toCSS`:

```js
import { toCSS, pierreDark } from 'chamele/themes';

toCSS(pierreDark);
// --cha-background: #0a0a0a;--cha-foreground: #fafafa;--cha-comment: #737373;--cha-comment-doc: #737373;...
```

> [!IMPORTANT] CSS-variable mode ignores `font_style` and `font_weight`. Its
> custom properties control all emitted colors.

## Development

```bash
moonx chamele:build   # preprocess and compile WAT with wabt + binaryen
moonx chamele:test    # run tests
moonx chamele:bench   # run benchmarks
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for internals.

## License

Apache-2.0
