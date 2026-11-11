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
import { createHighlighter } from '@pierre/highlights';
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
Each descriptor has one lexer entry, so every alias maps to `0`. The canonical
name is added automatically.

## Writing a lexer

Define `$highlight` with no parameters or return value. You can pass a complete
`(module ...)` or its contents. The compiler supplies memory, token output, and
shared scanners.

- `$ptr` is the current input pointer. `$end` is the exclusive input end.
- `$emitTok(type, start, end)` emits a token. Emit contiguous input spans in
  order.
- `$emitGap(start, end)` emits whitespace that inherits the previous token.
- `(enum.get $Token.number)` selects a token type. See
  `@pierre/wat-tools/token.wat` for the available types.
- `$lexIsDigit`, `$lexIsIdentStart`, `$lexScanIdent`, and `$lexScanNumber`
  provide common byte predicates and scanners. Scanners advance `$ptr`.
- `$utf8SpanEnd(end, limit)` extends an end pointer to a complete UTF-8
  character. Never split a token inside a UTF-8 character.

The compiler makes the shared modules available through imports such as
`(import "@pierre/wat-tools/common.wat")` and
`(import "@pierre/wat-tools/sig.wat")`. Repeated imports are included once.
Unused functions are removed from the compiled module.

Declare static storage with `(memory-region $mem.exampleStack 1024 16)`. The
last argument is optional alignment in bytes, which must be a power of two.
Regions belong to that lexer module and cannot overlap the emitter or other
lexers. `(i32.const $mem.exampleStack)` resolves to its allocated address. Do
not declare another memory or hard-code addresses.

## Compiler utilities

The package also exports `transformWat`, `flattenWat`, `wat2wasm`, `wasmToText`,
`optimizeWasm`, and lower-level WAT transformation helpers. `transformWat`
supports enums, constants, memory regions, byte sets, keyword tables, and the
language dispatch forms used by the built-in Highlights lexers.

## Raw lexer interface

Generated modules export `memory`, `inputPtr`, `lex()`, `lexStream(reset)`,
`record(type, end)` and `gap(end)`. Highlights manages these exports for you.

Input is UTF-8 at `inputPtr`. The control header stores input byte length at
offset `2`, output pointer at `6`, and output byte length at `10`, all as
little-endian `u32`. Output records are pairs of `u32` values: the exclusive
byte offset from input start, then the token type. Adjacent tokens of the same
type are merged.

Grow memory before you write large inputs. Leave 48 bytes after the input. Read
the memory buffer again after each call because output can grow memory.

Token type `255` marks an initial gap. An embedded lexer passes that gap to its
parent so it inherits the previous parent token. At the document root it becomes
plain text (`0`). `record` and `gap` take absolute end pointers in the parent
module's memory.

`lex()` starts a fresh document. `lexStream(1)` starts a stream and
`lexStream(0)` continues it. Stateful lexers must preserve their own state
across continuations. The shared comment and string scanners preserve their
modes.

## License

Apache-2.0.
