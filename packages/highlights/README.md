# Highlights, from Pierre

`@pierre/highlights` is a syntax highlighter written in WebAssembly Text (WAT).
It supports 152 built-in languages and Zed-compatible themes. It produces HTML
or themed tokens from complete input, input chunks, or document edits.

Read the [Documentation](https://diffs.com/docs#highlights).

## Installation

```bash
pnpm add @pierre/highlights
```

The core package imports no language or theme bundle. `createHighlighter()`
compiles the selected WebAssembly modules. Its `codeToHtml()` and
`codeToTokens()` methods then run synchronously.

The package runs in Node.js, browsers, and Cloudflare Workers. Workers cannot
compile WebAssembly from bytes, so the `workerd` export condition selects
modules that import compiled `.wasm` files.

## Quick start

```ts
import { createHighlighter } from '@pierre/highlights';
import ts from '@pierre/highlights/langs/typescript';
import { pierreDark } from '@pierre/highlights/themes';

const highlighter = await createHighlighter({
  langs: [ts],
  themes: [pierreDark],
});

const htmlBytes = highlighter.codeToHtml('const a = 1', {
  lang: 'js',
  theme: 'pierre-dark',
});
const html = new TextDecoder().decode(htmlBytes);
```

The TypeScript module supports `ts`, `tsx`, `cts`, `mts`, `js`, `jsx`, `mjs`,
and `cjs`. Each language module contains its standalone Wasm as base64. Import
only the languages and themes that your application needs.

Embedded code uses the same registered languages. With `langs: [ts, html]`, HTML
script bodies use TypeScript's JavaScript lexer. Style bodies remain plain text
until you add CSS. Code fences also accept registered custom language names.

`highlighter.getLoadedLanguages()` returns the names and aliases that `lang`
accepts. A `ThemeFamily` in `themes` registers each of its members.

## Full language and theme bundle

```ts
import { createHighlighter } from '@pierre/highlights';
import { langs } from '@pierre/highlights/langs';
import { themes } from '@pierre/highlights/themes';

const highlighter = await createHighlighter({ langs, themes });
```

`langs` contains one combined lexer Wasm module. It does not load each language
module separately. The emitter Wasm receives the source and token records from
the lexer.

## Custom lexers

Use `@pierre/wat-tools` at build time to compile your own lexer:

```ts
import { buildHighlightsLexer } from '@pierre/wat-tools';

const language = buildHighlightsLexer({
  name: 'language-id',
  alias: {},
  wat: `(module
    (func $highlight
      (call $emitTok
        (enum.get $Token.keyword)
        (global.get $ptr)
        (global.get $end))))`,
});
```

The result implements the `Language` type. Save this descriptor in a JavaScript
module and pass it to `createHighlighter({ langs: [language], themes })`. A
custom name that a built-in language also uses takes only that name. The
[lexer guide](../wat-tools/README.md) describes the shared scanners, token
types, and memory declarations.

## Output and shared runtime

`codeToHtml()` returns UTF-8 HTML bytes that can share WebAssembly memory.

Decode the bytes before the next call to the highlighter. Use `.slice()` to keep
a copy for later use.

`createHighlighter({ langs, themes })` requires an options object and returns a
promise. The previous no-argument and `WebAssembly.Module` forms are no longer
supported.

The `@pierre/highlights/full` entry initializes a shared highlighter at import.
It provides the top-level `codeToHtml()` and `codeToTokens()` functions,
`StreamTokenizer`, and `LiveTokenizer`. Its `createHighlighter` export uses the
same options-only async API. The main entry exports only `createHighlighter`,
`isSupportedLanguage`, and the types.

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
