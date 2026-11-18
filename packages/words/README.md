# Words, from Pierre

`@pierre/words` is a Markdown renderer written in WebAssembly Text (WAT). It
supports CommonMark 0.31.2 and GFM 0.29, and writes HTML or ANSI. The core has
no runtime dependencies. A React component for streaming text and a code
highlighting plugin are optional.

[Demo](https://diffs.com/words) · [Documentation](https://diffs.com/docs#words)
· [Agent skill](../../skills/words/SKILL.md)

## Installation

```bash
pnpm add @pierre/words
```

The package runs in Node.js, browsers, and Cloudflare Workers.

## Quick start

```js
import { renderToAnsi, renderToHtml } from '@pierre/words';

const html = new TextDecoder().decode(renderToHtml('# Hello, **world**!'));
process.stdout.write(renderToAnsi('# Hello, **world**!', { width: 80 }));
```

Both functions take a string, `Uint8Array`, or `ArrayBuffer`. They return a
`Uint8Array` that shares Wasm memory, so decode or copy it before the next
render.

`renderToHtml()` options:

| Option        | Default | Purpose                                                                                |
| ------------- | ------- | -------------------------------------------------------------------------------------- |
| `frontmatter` | `false` | Parse YAML frontmatter and return `[meta, output]`. `meta` is `null` if there is none. |
| `skipHtml`    | `false` | Omit raw HTML.                                                                         |
| `escapeHtml`  | `false` | Show raw HTML as escaped text. See [Raw HTML as text](#raw-html-as-text).              |
| `incomplete`  | `false` | Complete common unfinished inline syntax.                                              |
| `math`        | `false` | Render math as SVG. See [Math](#math).                                                 |
| `cjk`         | `false` | Enable [CJK-friendly emphasis](#cjk-support).                                          |

`renderToAnsi()` takes `width`, the wrap column. With the default, `0`, the
terminal wraps the text. Control characters print as U+FFFD, so a document
cannot send escape sequences. It also takes `math` and `cjk`; math shows its TeX
source.

**Warning:** `renderToHtml()` keeps raw HTML by default. Sanitize the output of
untrusted Markdown before you add it to a page. `skipHtml` alone is not a
sanitizer.

## React

```tsx
import { Markdown } from '@pierre/words/react';
import '@pierre/words/styles.css';

<Markdown isAnimating={status === 'streaming'} caret="block">
  {message.text}
</Markdown>;
```

Pass the full Markdown string on each update, and keep `isAnimating` true for as
long as text arrives. While it is true, the component completes unfinished
emphasis, code, and links, and hides unfinished images. Finished text renders as
normal Markdown.

| Prop                                    | Purpose                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `children`                              | Full Markdown string.                                                                         |
| `isAnimating`                           | The stream is active. Default: `false`.                                                       |
| `mode`                                  | `streaming` (default), or `static` for content that never streams.                            |
| `parseIncompleteMarkdown`               | Complete unfinished syntax while the stream is active. Default: `true`.                       |
| `animated`                              | Fade in new text. Use `true` or `{ animation: 'fadeIn', duration: 180 }`. Default: `false`.   |
| `caret`                                 | Show a `block` or `circle` caret while the stream is active.                                  |
| `components`                            | HTML hooks for generated elements, including `inlineCode`.                                    |
| `math`, `cjk`                           | Render math as SVG, and CJK-friendly emphasis. Default: `false`.                              |
| `escapeHtml`                            | Show raw HTML as text instead of omitting it. Default: `false`.                               |
| `plugins.code`                          | Code highlighter.                                                                             |
| `plugins.mermaid`                       | Mermaid diagram renderer. See [Mermaid](#mermaid).                                            |
| `plugins.renderers`                     | Custom code block renderers, selected by language.                                            |
| `controls`                              | Code copy/download buttons. Use a boolean or `{ code: { copy, download } }`. Default: `true`. |
| `lineNumbers`                           | Show code line numbers. Default: `true`.                                                      |
| `allowedElements`, `disallowedElements` | Element filters. Use only one of these props.                                                 |
| `unwrapDisallowed`                      | Keep the children of filtered elements.                                                       |
| `urlTransform`                          | Change link and image URLs before validation.                                                 |
| `idPrefix`                              | Prefix for generated ids, up to 4,096 bytes. Default: a unique React id.                      |
| `onAnimationStart`, `onAnimationEnd`    | Called when the stream starts and ends.                                                       |

Fades and the caret need `styles.css`. Fades run only during a stream. Reduced
motion and a zero duration turn them off.

Hooks take and return HTML strings, not React elements:

```tsx
const components = {
  a: (html: string) => html.replace('<a ', '<a class="message-link" '),
};

<Markdown components={components}>{text}</Markdown>;
```

The component omits raw HTML, or shows it as text with `escapeHtml`, and rejects
unsafe URL schemes. It allows external images, so use `urlTransform` or element
filters to block them. Hooks and plugins are trusted code: escape any untrusted
text they add.

Remark and rehype plugins are not supported.

### Syntax highlighting

```tsx
import { createHighlightsPlugin } from '@pierre/words/highlights';
import pierreLight from '@pierre/highlights/themes/pierre-light';

const plugins = { code: createHighlightsPlugin({ theme: pierreLight }) };

<Markdown plugins={plugins}>{text}</Markdown>;
```

Create the plugin once, outside the render. Unknown languages render as plain
text. React and `@pierre/highlights` are optional peer dependencies, and the
core entry point loads neither.

## Math

With `math: true`, the parser reads TeX between dollar signs and renders it as
SVG, with no other dependency:

```md
Inline math: $e^{i\pi} + 1 = 0$. Display math:
$$\sum_{n=1}^\infty \frac{1}{n^2}$$

$$
\begin{aligned}
f(x) &= \int_0^x t^2 \, dt \\
     &= \frac{x^3}{3}
\end{aligned}
$$
```

- `$...$` is inline math. As in Pandoc, the opening `$` must have a non-space
  after it, and the next `$` closes it only with a non-space before it and no
  digit after it. If that `$` cannot close it, the opening `$` is text, so
  `$5 and $10` stays text.
- `$$...$$` is display math, also inside a paragraph.
- A line that starts with `$$` and holds no other `$` opens a display block,
  which ends at a line that ends with `$$` (not `\$$`). As in TeX, the block
  holds no blank line: if a blank line comes before the closing `$$`, the
  opening line is text. Text after the opening `$$` and before the closing `$$`
  belongs to the formula.
- A `math` code fence is a display block too.

While a formula streams with `incomplete: true`, an open display block shows
what it has so far. Open inline math shows as plain text until its closing `$`.

The renderer covers the common LaTeX math commands: fractions, roots, scripts
and limits, big operators, `\left` and `\right`, matrices, `cases`, `aligned`,
`array`, accents, braces, extensible arrows, letter fonts, `\text`, `\color`,
and spacing. Glyphs use the system math font. The layout uses the metrics of
STIX Two Math, which Apple systems include; other math fonts work with small
spacing differences. A formula that it cannot lay out shows as code. An unknown
command shows in red, or in gray while its block is still open.

## CJK support

Set `cjk: true` to let asterisks and tildes mark emphasis and strikethrough next
to Chinese, Japanese, and Korean text. For example, `**重要。**请阅读。`
produces `<strong>重要。</strong>请阅读。` inside a paragraph. Use asterisks for
emphasis next to CJK punctuation.

The option works in `renderToHtml()`, `renderToAnsi()`, HTML sessions, and the
HTML and DOM renderers. In React, pass `<Markdown cjk>`.

## Mermaid

`@pierre/words/mermaid` renders `mermaid` code blocks with
[Pele](https://pele.run). Install `pele` and pass its `render` function to the
plugin.

```tsx
import { render } from 'pele';
import { createMermaidPlugin } from '@pierre/words/mermaid';

const plugins = { mermaid: createMermaidPlugin({ render }) };

<Markdown plugins={plugins}>{text}</Markdown>;
```

Use `plugins` with `createHtmlRenderer()` or `createDomRenderer()` too. The
second argument holds Pele's render options. While the fence is open, the
diagram grows with each complete line, and a line that does not parse keeps the
last diagram. An open fence with no diagram yet shows nothing. A closed diagram
that does not parse shows as code.

A renderer in `plugins.renderers` can return `null` the same way to show the
code block. The renderer keeps the output of a closed block and reuses it while
the language and code stay the same. Set `frame: true` on a renderer to show its
output in the code block frame, with the header and Copy/Download buttons, as
Mermaid diagrams do.

## HTML sessions

A session renders a growing string to HTML, without React or a browser:

```ts
import { createHtmlSession } from '@pierre/words';

const session = createHtmlSession();
const { html, stable, pending } = session.render('First paragraph.\n\nSecond');
session.render('First paragraph.\n\nSecond paragraph.');
```

`stable` holds completed blocks, `pending` holds the part that can still change,
and `html` holds both. Sessions omit raw HTML, or show it as text with
`{ escapeHtml: true }`.

Pass `{ incomplete: true }` as the second argument to complete unfinished
syntax. A link with no destination yet renders as
`<a data-markdown-incomplete>`. A session always renders an open code fence as
`<pre data-markdown-incomplete>`.

Appended text reuses completed blocks. An edit, a changed `incomplete` option,
or a link or footnote definition can force a full render. Single-line paragraphs
and top-level code fences can append literal content incrementally, including
paragraphs with completed inline formatting. Syntax changes and more complex
open blocks return to the parser.

`@pierre/words/html` exports `createHtmlRenderer()` for formatted HTML and
`createDomRenderer()` for DOM updates without React. See
[`html/types.ts`](./html/types.ts) for their options.

## Raw HTML as text

With `escapeHtml: true`, raw HTML shows as the text the source holds, as in a
chat that displays a model's markup literally. Inline HTML becomes escaped text.
An HTML block becomes a paragraph of its source lines, without Markdown inside
it. `renderToHtml()`, sessions, `createHtmlRenderer()`, `createDomRenderer()`,
and `<Markdown>` take the option. It takes precedence over `skipHtml`.

## Development

```bash
moonx words:build
moonx words:test
moonx words:test-spec
moonx words:bench --ignore-ci-checks
```

[Benchmarks](./benchmark/README.md) · [Architecture](./ARCHITECTURE.md)

## License

[Apache-2.0](./LICENSE.md)
