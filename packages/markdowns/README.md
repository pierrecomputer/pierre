# @pierre/markdowns

A fast markdown renderer written in WebAssembly Text (WAT).

- **Conformant**: Fully compliant to CommonMark `0.31.2` and GFM `0.29.0`.
- **Fast**: Up to 15× faster than
  [markdown-it](https://github.com/markdown-it/markdown-it), ahead of
  [md4x](https://github.com/unjs/md4x) native and wasm. See the
  [benchmark](./benchmark/README.md).
- **Lightweight**: 35 KB of gzipped Wasm, zero dependencies.
- **Two backends**: HTML, and ANSI for terminals.
- **YAML frontmatter**, parsed in Wasm and handed back as a plain object.

Try it in the [playground](https://md-playground.wat-labs.com).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./benchmark/benchmark-dark.svg">
  <img alt="benchmark" src="./benchmark/benchmark-light.svg">
</picture>

## Why it is fast

- **Two passes, no tree.** Block analysis writes a flat record stream into
  linear memory; rendering walks it once. There is no AST, and no per-node
  allocation.
- **One arena.** Input, records, output, and per-block scratch are four regions
  of one linear memory that only ever grow — the renderer never calls an
  allocator.
- **SIMD scans.** Finding the next line ending, the next inline mark, or the
  next byte to escape reads 16 bytes at a time; inline marks are classified with
  two `i8x16.swizzle` table lookups.
- **Zero-copy I/O.** Pass a `Uint8Array` and get a `Uint8Array` view of Wasm
  memory back, skipping both the UTF-8 encode and the decode.
- **Hand-written WATs.** Every hot-path instruction is intentional; no C/Rust →
  wasm compiler tax.

## Usage

```bash
pnpm add @pierre/markdowns
```

It runs in Node.js, browsers, and Cloudflare Workers; conditional exports pick
the right WebAssembly loader. The default JS entry point inlines its Wasm bytes,
so it also works during server rendering without filesystem access.

```js
import { renderToAnsi, renderToHtml } from '@pierre/markdowns';

const html = renderToHtml('# Hello, **world**!');
// Uint8Array of <h1>Hello, <strong>world</strong>!</h1>

const [meta, body] = renderToHtml(
  '---\ntitle: Hello, world!\n---\n# Hello, **world**!',
  { frontmatter: true }
);
// meta -> { title: "Hello, world!" }

process.stdout.write(renderToAnsi('# Hello, **world**!'));
```

### Render Options

```ts
interface RenderOptions {
  /** Parse a leading `---` YAML block and return `[meta, html]` */
  frontmatter?: boolean;
  /** Wrap text at this column; `0` leaves wrapping to the terminal */
  width?: number;
}
```

## Development

| Command                                             | Purpose                                                     |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm install`                                      | Install the dev dependencies                                |
| `moonx markdowns:build`                             | Compile `src/*.wat` to `dist/md.wasm`                       |
| `moonx markdowns:test`                              | Unit tests, fuzzing, and the grow suite                     |
| `moonx markdowns:test-spec`                         | The CommonMark and GFM conformance suites                   |
| `moonx markdowns:bench`                             | Benchmark against md4x and markdown-it                      |
| `moonx markdowns:playground-dev --ignore-ci-checks` | Serve the [playground](./playground/index.mjs) on localhost |

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before changing `src/`.

Large workloads are generated on demand. Run
`moon run markdowns:bench-large -- 1000 16 /tmp/large.json` for the 8.53 MB
case, or choose a large example in the docs demo. See the
[large-fixture measurements](./benchmark/STREAMING.md#large-fixtures) and
[browser instructions](./benchmark/RENDERING.md#large-browser-examples).

## License

[Apache-2.0](./LICENSE.md). The imported renderer retains its original
[MIT license](./LICENSE-MIT); see [NOTICE.md](./NOTICE.md) for attribution.

## React and streaming

The optional React entry point accepts a growing Markdown string:

```tsx
import { Markdown } from '@pierre/markdowns/react';
import '@pierre/markdowns/styles.css';

<Markdown isAnimating={status === 'streaming'} caret="block">
  {message.text}
</Markdown>;
```

`mode="streaming"` completes common unfinished emphasis, inline code, and links
in a display copy of the source. Incomplete images are hidden. Use
`parseIncompleteMarkdown={false}` to disable completion, or `mode="static"` for
normal Markdown semantics. This is not full Remend compatibility.

Append-only updates reuse completed top-level blocks and parse the open tail in
WAT. A newline-terminated blank line outside open containers is a safe boundary.
Lists, quotes, tables, and code stay mutable until the parser closes them.
Reference or footnote definitions trigger a full-document fallback, since they
can change earlier output. Edits and completion-option changes reset the cache.
A long open paragraph still requires parsing that whole paragraph.

React caches block signatures and incomplete-fence checks by node identity, and
memoizes unchanged output blocks. Component keys are stable by block position,
so appending content preserves existing component state. The same parser session
is available without React:

```ts
import { createMarkdownSession } from '@pierre/markdowns';

const session = createMarkdownSession();
session.render('First paragraph.\n\nSecond');
session.render('First paragraph.\n\nSecond paragraph.');
```

Session results reuse owned node objects; treat them as immutable. The stateless
`renderToElements()` API remains available.

| Prop                                    | Purpose                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `children`                              | Accumulated Markdown string                                                                                                                              |
| `animated`                              | Fade in newly appended text and code tokens: `true` or `{ animation: 'fadeIn', duration: 180 }` (milliseconds). Off by default; respects reduced motion. |
| `isAnimating`                           | Streaming UI state and incomplete-code controls                                                                                                          |
| `mode`                                  | `streaming` (default) or `static`                                                                                                                        |
| `parseIncompleteMarkdown`               | Complete common unfinished syntax (default `true`)                                                                                                       |
| `components`                            | React overrides for generated elements; `inlineCode` overrides inline code separately                                                                    |
| `plugins.code`                          | Synchronous token highlighter; unknown languages fall back to text                                                                                       |
| `plugins.renderers`                     | Custom fenced-code components selected by language                                                                                                       |
| `controls`                              | Enable code copy/download buttons, or configure `code.copy` and `code.download`                                                                          |
| `lineNumbers`                           | Show code line numbers (default `true`)                                                                                                                  |
| `caret`                                 | `block` or `circle`, shown while streaming                                                                                                               |
| `allowedElements`, `disallowedElements` | Mutually exclusive element filters                                                                                                                       |
| `unwrapDisallowed`                      | Keep children of filtered elements                                                                                                                       |
| `urlTransform`                          | Transform link/image URLs; transformed URLs are validated again                                                                                          |
| `onAnimationStart`, `onAnimationEnd`    | Streaming lifecycle callbacks                                                                                                                            |

Component overrides receive the element's React props, `children`, `node` (our
owned element record, not a unified AST), and `isIncomplete`. Code overrides
also receive `inline`. Custom components and plugins are trusted application
code. Styling is opt-in through `styles.css` and `data-markdown` attributes.
With incomplete Markdown completion enabled, link components mount as their
labels arrive and receive no `href` until the destination is complete and passes
URL validation. Keeping the same component preserves the label's fade timing and
text selection while streaming.

The React path omits raw HTML. It permits generated Markdown elements and
filters unsafe URL schemes, including `javascript:` and `data:`. External
HTTP(S) images are allowed; applications can use `urlTransform` or element
filters to restrict image sources. The low-level `renderToHtml()` API retains
its existing raw HTML behavior and must not be inserted into an untrusted page
without sanitization.

### Optional syntax highlighting

```tsx
import { createHighlightsPlugin } from '@pierre/markdowns/highlights';
import pierreLight from '@pierre/highlights/themes/pierre-light';

const plugins = { code: createHighlightsPlugin({ theme: pierreLight }) };

<Markdown plugins={plugins}>{text}</Markdown>;
```

Each code block gets an independent Highlights `LiveTokenizer` session. Appends
reuse earlier line tokens and lexer checkpoints; replacements or language
changes reset that block's session. Sessions release their tokenizer on unmount
or plugin replacement. Keep the plugin object stable across renders (as above).
Both highlighting paths normalize CRLF and CR line endings to LF.

Run `moon run markdowns:bench-stream` to compare full and incremental parsing
and highlighting over identical 64-character append streams. It measures parser
and token production, excluding React/DOM rendering and Streamdown.

React and Highlights are optional peers. Neither is loaded by the low-level
Markdown entry point. Math, Mermaid, CJK-specific extensions, arbitrary raw
HTML, and remark/rehype plugin compatibility are outside this initial React API.

### Fade in new tokens

```tsx
<Markdown
  isAnimating={status === 'streaming'}
  animated={{ animation: 'fadeIn', duration: 240 }}
>
  {message.text}
</Markdown>
```

Import `@pierre/markdowns/styles.css` for the fade styles. The effect runs only
while `isAnimating` is true in streaming mode. Each delivered text chunk fades
together; earlier chunks retain their timing even when a word grows across
updates. Finished spans merge into plain text, so animation history stays small.
Cleanup waits when it would disturb selected text, then resumes when selection
clears. Static content and paused streams remain fully visible. Reduced motion
and a zero duration bypass animation bookkeeping. Custom fenced-code renderers
control their own animations.
