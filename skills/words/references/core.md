# Core renderer

Use `@pierre/words` for synchronous, dependency-free HTML or terminal output.
The package selects its WebAssembly loader for Node.js, browsers, or Cloudflare
Workers. `init(module)` is for embedders that supply a compiled
`WebAssembly.Module` to replace the shared instance.

```ts
import { renderToAnsi, renderToHtml } from '@pierre/words';

const source = '# Hello, **world**!';
const html = new TextDecoder().decode(renderToHtml(source));
const ansi = renderToAnsi(source, { width: 80 }).slice();
```

Both functions accept a string, a UTF-8 `Uint8Array`, or an `ArrayBuffer`. The
result is a `Uint8Array` view into shared WebAssembly memory. Decode or copy it
before the next Words render, including a session or renderer update, can
overwrite or detach it.

## HTML

`renderToHtml(input, options?)` accepts `skipHtml`, `allowedHtml`, `incomplete`,
`frontmatter`, `math`, and `cjk`. All default to `false`. Set `incomplete: true`
for a preview of unfinished inline syntax. See [Extensions](extensions.md) for
`math` and `cjk`.

Core output preserves raw HTML by default. `skipHtml: true` drops raw HTML.
`allowedHtml` keeps only the listed tags and attributes, drops unsafe ones such
as `on*` and `javascript:` URLs, and closes open tags itself. Sanitize output
from untrusted Markdown before placing it in a page, including link and image
URLs. The [HTML renderer](html.md) checks Markdown URLs and omits raw HTML by
default.

## Frontmatter

With `frontmatter: true`, `renderToHtml()` removes the leading YAML block and
returns `[meta, bytes]`.

```ts
import { renderToHtml } from '@pierre/words';

const [meta, bytes] = renderToHtml('---\ntitle: Hello\n---\n# Hello', {
  frontmatter: true,
});
const html = new TextDecoder().decode(bytes);
```

`meta` can be any JSON value and is `null` if the document has no frontmatter.
`renderToHtml<T>()` supplies a TypeScript type for metadata. Validate the value
before use. Use this API to extract frontmatter in an app that renders the body
elsewhere.

## ANSI

`renderToAnsi(input, { width, math, cjk })` writes terminal formatting. Set
`width` to a wrap column up to 4096. The default `0` leaves wraps to the
terminal. Input control characters become U+FFFD. With `math: true`, formulas
appear as TeX source.
