# Highlights, from Pierre

`@pierre/highlights` is a syntax highlighter written in WebAssembly Text (WAT).
It supports 190 built-in languages and Zed-compatible themes. It produces HTML
or themed tokens from complete input, input chunks, or document edits.

Read the [Documentation](https://diffs.com/docs#highlights).

## Installation

```bash
pnpm add @pierre/highlights
```

The package has two entries:

| Entry                     | Contents                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `@pierre/highlights`      | All lexers in one Wasm module, initialized at import, and all themes                     |
| `@pierre/highlights/core` | No lexers or themes. `createHighlighter()` compiles the language modules that you select |

Both entries export the same functions and types. In `/core`, call `init()` with
the combined module before the shared functions and tokenizers. The package
exports that module as `@pierre/highlights/highlights.wasm`:

```ts
import { init } from '@pierre/highlights/core';

init(
  await WebAssembly.compileStreaming(
    fetch(new URL('@pierre/highlights/highlights.wasm', import.meta.url))
  )
);
```

The package runs in Node.js, browsers, and Cloudflare Workers. Workers cannot
compile WebAssembly from bytes, so the `workerd` export condition selects
modules that import compiled `.wasm` files.

## Quick start

```ts
import { codeToHtml, pierreDark } from '@pierre/highlights';

const html = new TextDecoder().decode(
  codeToHtml('const a = 1', { lang: 'ts', theme: pierreDark })
);
```

## Selected languages

`createHighlighter()` compiles the selected WebAssembly modules. Its
`codeToHtml()` and `codeToTokens()` methods then run synchronously.

```ts
import { createHighlighter } from '@pierre/highlights/core';
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
Vue, Svelte, Astro, MDX, and QML contain the lexer for their expressions, and
TypeScript contains the markup lexer for `html` tagged templates.

`highlighter.getLoadedLanguages()` returns the names and aliases that `lang`
accepts. A `ThemeFamily` in `themes` registers each of its members.

All languages and themes are also available as registered names:

```ts
import { createHighlighter } from '@pierre/highlights/core';
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
custom name that a built-in language also uses takes only that name: the other
names of the built-in language and its embedded code keep the built-in lexer.
When two lexers in `langs` declare the same name, the later one wins.

With the main entry, `registerLanguages([language])` adds the lexer to the
shared `codeToHtml()` and `codeToTokens()` functions. Its names override
built-in names there. Registration compiles base64 lexers synchronously and uses
the emitter in the combined module, so no other Wasm loads. The combined module
also lexes the built-in languages that a registered lexer embeds. Built-in
lexers do not embed registered languages, and `StreamTokenizer` and
`LiveTokenizer` use only built-in lexers. `isRegisteredLanguage(name)` tells you
if a name has a registered lexer. The [lexer guide](../wat-tools/README.md)
describes the shared scanners, token types, and memory declarations.

## Output and shared runtime

`codeToHtml()` returns UTF-8 HTML bytes that can share WebAssembly memory.

Decode the bytes before the next call to the highlighter. Use `.slice()` to keep
a copy for later use.

`createHighlighter({ langs, themes })` requires an options object and returns a
promise. The previous no-argument and `WebAssembly.Module` forms are no longer
supported.

The top-level `codeToHtml()` and `codeToTokens()` functions, `StreamTokenizer`,
and `LiveTokenizer` use the shared highlighter that the main entry initializes
at import.

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
