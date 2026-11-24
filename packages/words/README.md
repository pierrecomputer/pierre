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
| `allowedHtml` |         | Keep only these raw HTML tags. See [Raw HTML](#raw-html).                              |
| `escapeHtml`  | `false` | Show raw HTML as escaped text. See [Raw HTML](#raw-html).                              |
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

Words needs WebAssembly with SIMD. The Wasm compiles on the first render, so an
engine without it throws there, not at import. `canUseWASM()` returns `false` on
such engines, so you can pick a fallback renderer.

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
| `allowedHtml`                           | Raw HTML tags to keep. See [Raw HTML](#raw-html).                                             |
| `escapeHtml`                            | Show raw HTML as escaped text. See [Raw HTML](#raw-html).                                     |
| `plugins.code`                          | Code highlighter.                                                                             |
| `plugins.mermaid`                       | Mermaid diagram renderer. See [Mermaid](#mermaid).                                            |
| `islands`                               | Registered React components for reactive islands.                                             |
| `plugins.renderers`                     | Custom code block renderers, selected by language.                                            |
| `controls`                              | Code copy/download buttons. Use a boolean or `{ code: { copy, download } }`. Default: `true`. |
| `lineNumbers`                           | Show code line numbers. Default: `true`.                                                      |
| `allowedElements`, `disallowedElements` | Element filters. Use only one of these props.                                                 |
| `unwrapDisallowed`                      | Keep the children of filtered elements.                                                       |
| `urlTransform`                          | Change link and image URLs before validation.                                                 |
| `idPrefix`                              | Id prefix. Shares 4,096 bytes with inline island names. Default: a unique React id.           |
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

The component omits raw HTML, except the tags in `allowedHtml`, and rejects
unsafe URL schemes. It allows external images, so use `urlTransform` or element
filters to block them. Hooks and plugins are trusted code: escape any untrusted
text they add.

Remark and rehype plugins are not supported.

### Reactive islands

Pass an `islands` registry to mount React components from fenced blocks. The
language is `island-NAME` and the body is a JSON object with a nonempty string
`id`. Keep that id stable across edits to preserve component state. Use unique
ids within each Markdown instance. If an id repeats, the first accepted block
mounts and later blocks show their fallback.

````markdown
```island-counter
{"id":"article-votes","label":"Votes"}
```
````

```tsx
import { Markdown, type ReactiveIslands } from '@pierre/words/react';
import { useState } from 'react';

function Counter({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      {label} ({count})
    </button>
  );
}

const islands: ReactiveIslands = {
  counter: {
    fallback: 'Loading counter…',
    render: ({ label }) =>
      typeof label === 'string' ? <Counter label={label} /> : null,
  },
};

export function Message({
  source,
  streaming,
}: {
  source: string;
  streaming: boolean;
}) {
  return (
    <Markdown islands={islands} isAnimating={streaming}>
      {source}
    </Markdown>
  );
}
```

For a component embedded in a sentence, set `inline: true` on its registry entry
and return inline content such as a button or link.

```markdown
The parser lives in :file[inline.wat]{path="src/inline.wat"}.
```

Words passes the plain-text bracketed label as `data.label` and each attribute
as a string, so this example supplies `label: 'inline.wat'` and
`path: 'src/inline.wat'`. Attributes are optional. Quote values containing
spaces and use a backslash to escape punctuation. Use an explicit `id` to
preserve state when the label or attributes change. Otherwise Words derives
identity from the directive content and its occurrence among identical copies.

During a stream, the same `pending` option applies from the opening bracket
until the attributes close, or until the next character or end of stream
confirms there are no attributes. The default server fallback is the label.
Unknown names retain their usual Markdown behavior. Rejected or unfinished
directives display their source when the stream ends.

By default, Words leaves a registered fence out of the preview while it streams.
Set `pending` to plain text or to `{ className, label? }` for a CSS-styled
skeleton with an optional accessible label. For example, add
`pending: { className: 'counter-skeleton', label: 'Loading counter' }` to the
registry and style `.counter-skeleton` to reserve the button’s space.

A closed, accepted fence uses `fallback` on the server and mounts on the client
while the rest of the Markdown continues streaming. A paused open fence, invalid
payload, or unregistered name is displayed as code. The `render` function is a
pure factory that validates data and returns an element or `null`. Put hooks in
the component it returns.

### Syntax highlighting

```tsx
import { createHighlightsPlugin } from '@pierre/words/highlights';
import pierreLight from '@pierre/highlights/themes/pierre-light';

const plugins = { code: createHighlightsPlugin({ theme: pierreLight }) };

<Markdown plugins={plugins}>{text}</Markdown>;
```

Create the plugin once, outside the render. Unknown languages render as plain
text. To add a language, call `registerLanguages()` from `@pierre/highlights`
with a custom lexer. React and `@pierre/highlights` are optional peer
dependencies, and the core entry point loads neither.

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

An app that renders no TeX can import `@pierre/words/no-math` in place of
`@pierre/words`: the same API, with a module about a third smaller (66 KB
instead of 100 KB). With the `math` option, it shows formulas as code.

```ts
import { renderToHtml } from '@pierre/words/no-math';
```

## CJK support

Set `cjk: true` to let asterisks and tildes mark emphasis and strikethrough next
to Chinese, Japanese, and Korean text. For example, `**重要。**请阅读。`
produces `<strong>重要。</strong>请阅读。` inside a paragraph. Use asterisks for
emphasis next to CJK punctuation.

The option works in `renderToHtml()`, `renderToAnsi()`, HTML sessions, and the
HTML and DOM renderers. In React, pass `<Markdown cjk>`.

## Raw HTML

`allowedHtml` keeps a list of raw HTML tags, each with the attributes it keeps.
It works in `renderToHtml()`, HTML sessions, the HTML and DOM renderers, and
React, and it overrides `skipHtml`:

```tsx
const allowedHtml = { details: ['open'], summary: [], ref: ['id'] };

<Markdown allowedHtml={allowedHtml}>{text}</Markdown>;
```

- Tag and attribute names match in any case, and the output is lowercase, so
  `<Ref>` is `<ref>`.
- Other tags, comments, and attributes are dropped. Text of an HTML block shows
  only inside a kept element, without the content of `script`, `style`, and the
  other raw text elements.
- `on*`, `srcdoc`, `data-markdown*`, and `data-words*` attributes, `javascript:`
  and `vbscript:` values, and `script` tags never pass, even when listed.
- The HTML and DOM renderers and React check URL attributes such as `href` and
  `src` with the built-in URL check, and drop values that fail it.
- `/>` closes any element, so `<x-widget />` is empty. Void elements such as
  `br` and `img` need no closing tag.
- A paragraph, heading, or table cell closes the inline elements it opened. An
  element opened by an HTML block closes with its list item, quote, or the
  document. A closing tag without an open element in the same place is dropped.

While a kept element is open, a stream keeps everything after it pending, so
`<details>`, a blank line, and Markdown inside it render as one element. The
pending HTML closes the element until its closing tag arrives.

Element filters and hooks apply to kept tags as to generated ones.

**Warning:** Other listed attributes keep their values, and `urlTransform` does
not see kept tags. List only tags and attributes you trust.

`escapeHtml: true` shows raw HTML as escaped text instead, so
`Use <Stack> for rows` reads as written. An HTML block becomes a paragraph of
its source text, without Markdown inside it. It overrides `skipHtml` and
`allowedHtml`.

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
the language, meta, and code stay the same. Set `frame: true` on a renderer to
show its output in the code block frame, with the header and Copy/Download
buttons, as Mermaid diagrams do.

### Code options

`plugins.code.highlight()` and `plugins.renderers[].render()` receive
`CodeOptions`:

| Field          | Purpose                                                                       |
| -------------- | ----------------------------------------------------------------------------- |
| `code`         | Code lines, each ending with LF.                                              |
| `language`     | First word of the fence info string, or `text`.                               |
| `meta`         | Rest of the info string after the language, trimmed. `''` when there is none. |
| `isIncomplete` | The fence is still open.                                                      |

For ` ```ts title="a.ts" {3-5} `, `language` is `ts` and `meta` is
`title="a.ts" {3-5}`. The default code block shows a non-empty meta in a
`data-meta` attribute, so plain CSS can use it too.

## HTML sessions

A session renders a growing string to HTML, without React or a browser:

```ts
import { createHtmlSession } from '@pierre/words';

const session = createHtmlSession();
const { html, stable, pending } = session.render('First paragraph.\n\nSecond');
session.render('First paragraph.\n\nSecond paragraph.');
```

`stable` holds completed blocks, `pending` holds the part that can still change,
and `html` holds both. Sessions omit raw HTML, except the tags in
[`allowedHtml`](#raw-html).

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

## Loading the Wasm yourself

`@pierre/words/core` has the same API as `@pierre/words`, but it does not embed
the WebAssembly module as base64. Call `init()` with a compiled module before
the first render. The package exports the modules as `@pierre/words/words.wasm`
and `@pierre/words/words-no-math.wasm`. A `.wasm` file is about 20% smaller
after gzip, compiles off the main thread, and stays cached when your JavaScript
changes. This example needs a bundler such as Vite to resolve the URL:

```ts
import { init, renderToHtml } from '@pierre/words/core';

init(
  await WebAssembly.compileStreaming(
    fetch(new URL('@pierre/words/words.wasm', import.meta.url))
  )
);
```

The React and HTML renderers use `@pierre/words`, not this entry.

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
