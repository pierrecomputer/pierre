# @pierre/wat-tools

Build standalone WebAssembly lexers for `@pierre/highlights`.

```sh
pnpm add -D @pierre/wat-tools
```

Run the compiler at build time and save the returned descriptor in your language
module. Your application needs only that descriptor and `@pierre/highlights`.

```ts
import { buildHighlightsLexer } from '@pierre/wat-tools';
import { writeFileSync } from 'node:fs';

const language = buildHighlightsLexer({
  name: 'example',
  alias: { ex: 0 },
  wat: `(module
    (func $highlight
      (call $emitTok
        (enum.get $Token.keyword)
        (global.get $ptr)
        (global.get $end))))`,
});

writeFileSync(
  'src/example.js',
  `export default ${JSON.stringify(language)};\n`
);
```

```ts
import { createHighlighter } from '@pierre/highlights/core';
import { pierreDark } from '@pierre/highlights/themes';
import example from './example.js';

const highlighter = await createHighlighter({
  langs: [example],
  themes: [pierreDark],
});

highlighter.codeToHtml('example code', {
  lang: 'ex',
  theme: 'pierre-dark',
});
```

`buildHighlightsLexer` returns `{ name, aliases, wasm }`, which is assignable to
the Highlights `Language` type. `wasm` contains the compiled module as base64.
Cloudflare Workers cannot compile WebAssembly from bytes. There, write the
decoded bytes to a `.wasm` file, import it, and pass the module as `wasm`. Each
descriptor has one lexer entry, so every alias maps to `0`. The canonical name
is added automatically.

A name starts with a lowercase letter and can contain `a-z`, `0-9`, `_`, `.`,
`+`, and `-`. An alias can also contain `#`. Highlights reserves the name
`ansi`.

With the main `@pierre/highlights` entry, `registerLanguages([example])` adds
the lexer to the shared `codeToHtml()` and `codeToTokens()` functions. Its names
override built-in names there. `StreamTokenizer` and `LiveTokenizer` use
built-in lexers only. A Markdown fence uses a custom lexer only when the
`@pierre/highlights/langs/markdown` module is in the same `langs` list or is
registered too.

In `@pierre/diffs`, use
`registerCustomLanguage(name, loader, files, 'highlights')`. The loader returns
a module whose default export is the descriptor, such as
`() => import('./example.js')`. `name` must be one of the lexer's names.

## Writing a lexer

Define `$highlight` with no parameters or return value. You can pass a complete
`(module ...)` or its contents. The compiler supplies memory, token output, and
shared scanners.

- `$ptr` is the current input pointer. `$end` is the exclusive input end.
- `$emitTok(type, start, end)` emits a token. Emit contiguous input spans in
  order. Bytes that no token covers become plain text.
- `$emitGap(start, end)` emits whitespace that inherits the previous token.
- `(enum.get $Token.number)` selects a token type. See
  `@pierre/wat-tools/token.wat` for the available types. Do not emit
  `background` or `foreground`; they are theme colors, not syntax types.
- `$lexIsDigit`, `$lexIsIdentStart`, `$lexScanIdent`, and `$lexScanNumber`
  provide common byte predicates and scanners. Scanners advance `$ptr`.
- `$lexString` and `$lexRawString` take `(quote, multiline, type)`. They scan
  and emit the string at `$ptr`. `$lexLineComment` and `$lexBlockComment` take
  `(skip, type)`. They do the same for a comment whose opener is `skip` bytes
  long. A block comment ends at `*/`. In a stream, these four continue an open
  string or comment in the next chunk.
- `$utf8SpanEnd(end, limit)` extends an end pointer to a complete UTF-8
  character. Never split a token inside a UTF-8 character.

Your code and the shared modules have one namespace. Do not define a name that a
shared module uses, such as `$ptr` or a `$lex*`, `$scan*`, `$stream*`, or
`$sig*` function. Use a prefix for your own functions and globals.

The shared modules are already available, so imports such as
`(import "@pierre/wat-tools/common.wat")` and
`(import "@pierre/wat-tools/sig.wat")` are optional. Repeated imports are
included once. Relative imports do not resolve to your files, so put all your
code in `wat`. Unused functions are removed from the compiled module. A custom
lexer cannot embed another language.

Declare static storage with `(memory-region $mem.exampleStack 1024 16)`. The
name must start with `$mem.`. The last argument is optional alignment in bytes,
which must be a power of two; the default is 16. Each lexer module has its own
memory, but the shared modules reserve names such as `$mem.input`.
`(i32.const $mem.exampleStack)` resolves to its allocated address. Do not
declare another memory or hard-code addresses.

## Compiler utilities

The package also exports `transformWat`, `flattenWat`, `wat2wasm`, `wasmToText`,
`optimizeWasm`, and lower-level WAT transformation helpers. `transformWat`
supports the forms that the built-in Highlights lexers use: `enum`, `enum-map`,
`const`, `memory-region`, `byteset.get`, `bitset`, `keyword-table`,
`keyword-pool`, `byte-switch`, `func-variant`, `language-table`, and string
operands such as `(i32.const "ab")`. They also work in `buildHighlightsLexer`.

## Streams

Highlights can run a lexer on a stream of chunks, such as the lines of a quoted
Markdown fence. A stateful lexer must keep its own state between chunks. Keep
that state in globals, and reset them when `$streamReset` is `1`. The shared
comment and string scanners keep their modes. When an open string or comment
covers a whole chunk, `$highlight` does not run for that chunk.

## License

Apache-2.0.
