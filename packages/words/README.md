# Words, from Pierre

`@pierre/words` is a Markdown renderer written in WebAssembly Text (WAT). It
supports CommonMark 0.31.2 and GFM 0.29, and writes HTML or ANSI. The core has
no runtime dependencies. A React component for streaming text and a code
highlighting plugin are optional.

Try the [demo](https://diffs.com/words).

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
| `incomplete`  | `false` | Complete common unfinished inline syntax.                                              |

`renderToAnsi()` takes `width`, the wrap column. With the default, `0`, the
terminal wraps the text. Control characters print as U+FFFD, so a document
cannot send escape sequences.

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
| `plugins.code`                          | Code highlighter.                                                                             |
| `plugins.renderers`                     | Custom code block renderers, selected by language.                                            |
| `controls`                              | Code copy/download buttons. Use a boolean or `{ code: { copy, download } }`. Default: `true`. |
| `lineNumbers`                           | Show code line numbers. Default: `true`.                                                      |
| `allowedElements`, `disallowedElements` | Element filters. Use only one of these props.                                                 |
| `unwrapDisallowed`                      | Keep the children of filtered elements.                                                       |
| `urlTransform`                          | Change link and image URLs before validation.                                                 |
| `idPrefix`                              | Prefix for generated ids. Default: a unique React id.                                         |
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

The component omits raw HTML and rejects unsafe URL schemes. It allows external
images, so use `urlTransform` or element filters to block them. Hooks and
plugins are trusted code: escape any untrusted text they add.

Math, Mermaid, CJK extensions, and remark or rehype plugins are not supported.

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

## HTML sessions

A session renders a growing string to HTML, without React or a browser:

```ts
import { createHtmlSession } from '@pierre/words';

const session = createHtmlSession();
const { html, stable, pending } = session.render('First paragraph.\n\nSecond');
session.render('First paragraph.\n\nSecond paragraph.');
```

`stable` holds completed blocks, `pending` holds the part that can still change,
and `html` holds both. Sessions omit raw HTML.

Pass `{ incomplete: true }` as the second argument to complete unfinished
syntax. A link with no destination yet renders as
`<a data-markdown-incomplete>`, and an open code fence as
`<pre data-markdown-incomplete>`.

Appended text reuses completed blocks. An edit, a changed `incomplete` option,
or a link or footnote definition can force a full render. A long open paragraph
is parsed again on each update.

`@pierre/words/html` exports `createHtmlRenderer()` for formatted HTML and
`createDomRenderer()` for DOM updates without React. See
[`html/types.ts`](./html/types.ts) for their options.

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
