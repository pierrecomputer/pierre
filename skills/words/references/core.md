# Core API

## HTML bytes

```ts
import { renderToHtml } from '@pierre/words';

const html = new TextDecoder().decode(renderToHtml('# Hello, **world**!'));
```

`renderToHtml()` accepts a string, `Uint8Array`, or `ArrayBuffer`. Byte input
uses UTF-8. The result is a `Uint8Array` that shares WebAssembly memory. Decode
it immediately, or call `.slice()` to retain bytes across another render. HTML
and ANSI calls use the same instance.

| Option        | Default | Effect                                                                    |
| ------------- | ------- | ------------------------------------------------------------------------- |
| `skipHtml`    | `false` | Omit raw HTML from the Markdown source                                    |
| `incomplete`  | `false` | Complete common unfinished inline syntax for display                      |
| `frontmatter` | `false` | Return `[meta, output]` and remove leading YAML frontmatter from the body |

Core HTML preserves raw HTML by default. `skipHtml: true` omits raw HTML, but
Markdown links and images still need URL checks. Sanitize core output before
insertion into a page if the source is untrusted. The
[formatted HTML API](html.md) applies URL checks and omits raw HTML.

## Frontmatter

```ts
import { renderToHtml } from '@pierre/words';

const [meta, bytes] = renderToHtml('---\ntitle: Hello\n---\n# Hello', {
  frontmatter: true,
  skipHtml: true,
});
const html = new TextDecoder().decode(bytes);
```

`meta` is `null` when no frontmatter exists. The `Frontmatter` type permits any
JSON value, such as arrays and scalars. Validate metadata before use.
`renderToHtml<MyMetadata>(source, { frontmatter: true })` changes the TypeScript
return type only. It does not validate the data.

Frontmatter extraction belongs to `renderToHtml()`. Sessions and the React,
HTML, and DOM renderers have no frontmatter option.

## ANSI bytes

```ts
import { renderToAnsi } from '@pierre/words';

process.stdout.write(renderToAnsi('# Hello, **world**!', { width: 80 }));
```

`renderToAnsi()` accepts the same input types and returns shared UTF-8 bytes.
`width` sets the wrap column. With `0`, the default, the terminal controls line
wrap. Positive values have a maximum of 4096. Input control characters render as
U+FFFD instead of terminal escape sequences.

## Runtime

Import from `@pierre/words` so conditional exports select the correct
WebAssembly entry point. `init(module)` replaces the shared instance for
embedders with their own compiled `WebAssembly.Module`. It is not necessary for
normal use.

Core public types are `RenderOptions`, `AnsiOptions`, `Frontmatter`,
`HtmlSessionOptions`, and `HtmlUpdate`.
