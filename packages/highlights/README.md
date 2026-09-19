# Highlights, from Pierre

`@pierre/highlights` is a syntax highlighter written in WebAssembly Text (WAT),
with 73 built-in languages and Zed-compatible themes. It generates HTML or
themed tokens and supports streaming input and incremental edits.

Read the [Documentation](https://diffs.com/docs#highlights).

## Installation

```bash
pnpm add @pierre/highlights
```

Runs in Node.js, browsers, and Cloudflare Workers. The package initializes
WebAssembly automatically; highlighting calls are synchronous after import.

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

`codeToHtml()` returns UTF-8 HTML bytes. Decode them immediately, or copy them
with `.slice()` before the next highlighting or tokenization call.

See the [docs](https://diffs.com/docs#highlights) for token rendering,
streaming, incremental editing, themes, and the API reference.

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
