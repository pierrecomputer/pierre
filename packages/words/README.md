# @pierre/words

A fast Markdown renderer written in WebAssembly Text (WAT).

- CommonMark `0.31.2` and GFM `0.29.0` support.
- HTML and ANSI output, with optional YAML frontmatter.
- No runtime dependencies in the core renderer.
- Optional React component, incremental HTML updates, and syntax highlighting.

The parser uses two passes, flat records, and 16-byte SIMD scans. It creates no
syntax tree. See the [architecture](./ARCHITECTURE.md) and
[benchmarks](./benchmark/README.md).

## Usage

```bash
pnpm add @pierre/words
```

Words runs in Node.js, browsers, and Cloudflare Workers. Package exports select
the Wasm loader. The default entry point includes the Wasm bytes and needs no
filesystem access.

```js
import { renderToAnsi, renderToHtml } from '@pierre/words';

const html = new TextDecoder().decode(renderToHtml('# Hello, **world**!'));
process.stdout.write(renderToAnsi('# Hello, **world**!', { width: 80 }));
```

Both functions accept a string, `Uint8Array`, or `ArrayBuffer`. They return a
`Uint8Array` view of Wasm memory. Copy or decode the result before the next
render call.

`renderToHtml()` accepts these options:

| Option        | Default | Purpose                                             |
| ------------- | ------- | --------------------------------------------------- |
| `frontmatter` | `false` | Parse YAML frontmatter and return `[meta, output]`. |
| `skipHtml`    | `false` | Omit raw HTML from the source.                      |
| `incomplete`  | `false` | Complete common unfinished inline syntax.           |

With `frontmatter: true`, `meta` contains the parsed YAML value, or `null` when
frontmatter is absent:

```js
const [meta, output] = renderToHtml('---\ntitle: Hello\n---\n# Hello', {
  frontmatter: true,
});
```

`renderToAnsi()` accepts `width` for the terminal wrap column. Its default is
`0`, which lets the terminal wrap the text.

`renderToHtml()` preserves raw HTML by default. Sanitize output from untrusted
Markdown before insertion into a page. `skipHtml` alone is not a sanitizer.

## React

```tsx
import { Markdown } from '@pierre/words/react';
import '@pierre/words/styles.css';

<Markdown isAnimating={status === 'streaming'} caret="block">
  {message.text}
</Markdown>;
```

Pass the full Markdown string on each update. React owns one container. The HTML
renderer updates its native DOM nodes.

| Prop                                    | Purpose                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `children`                              | Full Markdown string.                                                                         |
| `mode`                                  | `streaming` (default) or `static`.                                                            |
| `parseIncompleteMarkdown`               | Complete unfinished syntax. Default: `true`.                                                  |
| `isAnimating`                           | Mark the stream as active. Default: `false`.                                                  |
| `animated`                              | Fade in new text. Use `true` or `{ animation: 'fadeIn', duration: 180 }`. Default: `false`.   |
| `caret`                                 | Show a `block` or `circle` caret while the stream is active.                                  |
| `components`                            | HTML string hooks for generated elements, including `inlineCode`.                             |
| `plugins.code`                          | Code highlighter.                                                                             |
| `plugins.renderers`                     | Custom code-fence renderers, selected by language.                                            |
| `controls`                              | Code copy/download buttons. Use a boolean or `{ code: { copy, download } }`. Default: `true`. |
| `lineNumbers`                           | Show code line numbers. Default: `true`.                                                      |
| `allowedElements`, `disallowedElements` | Element filters. Use only one of these props.                                                 |
| `unwrapDisallowed`                      | Keep the children of filtered elements.                                                       |
| `urlTransform`                          | Transform link and image URLs before validation.                                              |
| `onAnimationStart`, `onAnimationEnd`    | Callbacks for stream activity.                                                                |

The default mode completes common unfinished emphasis, code, and links. It hides
incomplete images. Use `mode="static"` for normal Markdown semantics, or
`parseIncompleteMarkdown={false}` to disable completion. Completion does not
provide full Remend compatibility.

Fades require `styles.css` and an active stream. The duration is in
milliseconds. Reduced motion and a zero duration disable fades.

HTML hooks receive and return strings, not React elements:

```tsx
const components = {
  a: (html: string) => html.replace('<a ', '<a class="message-link" '),
};

<Markdown components={components}>{text}</Markdown>;
```

The React renderer omits raw HTML and rejects unsafe URL schemes. External
HTTP(S) images are permitted. Use URL or element filters to restrict them. Hooks
and plugins are trusted code: escape any untrusted text that they add.

### Syntax highlighting

```tsx
import { createHighlightsPlugin } from '@pierre/words/highlights';
import pierreLight from '@pierre/highlights/themes/pierre-light';

const plugins = { code: createHighlightsPlugin({ theme: pierreLight }) };

<Markdown plugins={plugins}>{text}</Markdown>;
```

Keep the plugin object stable across renders. Unknown languages use escaped
text. React and Highlights are optional peers. The core entry point loads
neither.

The React API does not include math, Mermaid, CJK extensions, raw HTML, or
remark/rehype plugins.

## HTML sessions

Use an HTML session for incremental output without React or a browser:

```ts
import { createHtmlSession } from '@pierre/words';

const session = createHtmlSession();
const { html, stable, pending } = session.render('First paragraph.\n\nSecond');
session.render('First paragraph.\n\nSecond paragraph.');
```

`html` contains the full output. `stable` contains completed blocks, and
`pending` contains the mutable suffix. Pass `{ incomplete: true }` as the second
argument to complete unfinished syntax.

Append updates reuse completed blocks. Edits, completion-option changes, and
global link or footnote definitions can require a full render. A long open
paragraph still requires a full parse of that paragraph.

`@pierre/words/html` exports `createHtmlRenderer()` for formatted HTML and
`createDomRenderer()` for native DOM updates. See the
[HTML options](./html/types.ts) for filters, hooks, and plugins.

## Development

| Command                                | Purpose                                   |
| -------------------------------------- | ----------------------------------------- |
| `pnpm install`                         | Install dependencies.                     |
| `moonx words:build`                    | Build Wasm, JavaScript, and declarations. |
| `moonx words:test`                     | Run the test suites.                      |
| `moonx words:test-spec`                | Check CommonMark and GFM conformance.     |
| `moonx words:bench --ignore-ci-checks` | Compare parser performance.               |

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before edits to `src/`. The
[benchmark guide](./benchmark/README.md) covers HTML throughput, React streams,
and memory measurements.

## License

[Apache-2.0](./LICENSE.md).
