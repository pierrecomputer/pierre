# Highlights, from Pierre

`@pierre/highlights` is a syntax highlighter written in WebAssembly Text (WAT).
It supports 73 built-in languages and Zed-compatible themes. It produces HTML or
themed tokens from complete input, input chunks, or document edits.

Read the [Documentation](https://diffs.com/docs#highlights).

## Installation

```bash
pnpm add @pierre/highlights
```

The package runs in Node.js, browsers, and Cloudflare Workers. It initializes
WebAssembly at import. `codeToHtml()` and `codeToTokens()` run synchronously
after import.

## Quick start

```js
import { codeToHtml } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

const htmlBytes = codeToHtml("console.log('Hello world!')", {
  lang: 'js',
  theme: pierreDark,
});
const html = new TextDecoder().decode(htmlBytes);
```

`codeToHtml()` returns UTF-8 HTML bytes that can share WebAssembly memory.

Decode the bytes before the next call to the highlighter. Use `.slice()` to keep
a copy for later use.

Read the [API reference](https://diffs.com/docs#highlights) for tokens, input
streams, document edits, and themes.

## Development

```bash
moonx highlights:build
moonx highlights:dev
moonx highlights:test
moonx highlights:bench
moonx highlights:bench-live
moonx highlights:bench-memory
```

[Benchmarks](./benchmark/README.md) · [Architecture](./ARCHITECTURE.md) ·
[Bundled themes](./themes/README.md)

## License

[Apache-2.0](./LICENSE.md)
