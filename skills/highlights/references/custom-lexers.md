# Custom lexers in WAT

Write a lexer for a new language in WebAssembly text (WAT). Compile it at build
time with `@pierre/wat-tools`, and ship only the returned descriptor.

```bash
pnpm add -D @pierre/wat-tools
```

## Build and register

`buildHighlightsLexer({ name, alias, wat })` returns `{ name, aliases, wasm }`.
`wasm` is base64. Save the descriptor as a module:

```ts
import { buildHighlightsLexer } from '@pierre/wat-tools';
import { readFileSync, writeFileSync } from 'node:fs';

const conf = buildHighlightsLexer({
  name: 'conf',
  alias: ['cfg'],
  wat: readFileSync('conf.wat', 'utf8'),
});
writeFileSync('src/conf.js', `export default ${JSON.stringify(conf)};\n`);
```

Then use it in one of these places:

| Host                            | Call                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `@pierre/highlights/core`       | `await createHighlighter({ langs: [conf], themes })`                             |
| `@pierre/highlights` main entry | `registerLanguages([conf])`; also used by both tokenizers                        |
| `@pierre/diffs`                 | `registerCustomLanguage('conf', () => import('./conf.js'), files, 'highlights')` |

- A name starts with `a-z` and can contain `a-z`, `0-9`, `_`, `.`, `+`, and `-`.
  An alias can also contain `#`. `ansi` is reserved.
- A registered name overrides a built-in name in the shared functions.
- Cloudflare Workers cannot compile Wasm from bytes. Write the decoded bytes to
  a `.wasm` file, import it, and pass the module as `wasm`.
- A lexer built by an older `@pierre/wat-tools` is rejected. Build it again.

## The lexer contract

Define `$highlight` with no params and no result. Pass a whole `(module ...)` or
only its contents. The compiler adds memory, output, and the shared scanners.

| Name                     | Meaning                                                   |
| ------------------------ | --------------------------------------------------------- |
| `$ptr`                   | Read cursor (global). Advance it as you scan              |
| `$end`                   | Exclusive input end. The byte at `$end` is a NUL sentinel |
| `$emitTok(type, lo, hi)` | Emit a token for `[lo, hi)`. Empty spans are dropped      |
| `$emitGap(lo, hi)`       | Emit whitespace that keeps the previous token type        |
| `(enum.get $Token.x)`    | A token type constant                                     |

Emit rules:

- Emit spans in order. A token also takes the bytes skipped before it. Bytes
  after the last token become plain text.
- Skip only whitespace. Streams and `LiveTokenizer` cut runs at each line, so
  skipped bytes at a line end are plain there.
- Never end a token inside a UTF-8 character. For an unknown byte, use
  `$utf8SpanEnd(ptr + 1, $end)`.
- Advance `$ptr` by at least one byte in each loop step, or the loop never ends.
- Do not emit `background` or `foreground`. They are theme colors.

Common token types: `comment`, `comment.doc`, `keyword`, `keyword.control`,
`keyword.declaration`, `keyword.import`, `keyword.operator`, `string`,
`string.escape`, `string.regex`, `number`, `boolean`, `constant`,
`constant.builtin`, `function`, `function.definition`, `function.method`,
`type`, `type.builtin`, `variable`, `variable.parameter`, `property`,
`operator`, `punctuation`, `punctuation.bracket`, `punctuation.delimiter`,
`tag`, `attribute`, `namespace`, `label`, `preproc`, `none`. The full list is in
`@pierre/wat-tools/token.wat`.

## Shared helpers

| Helper                                    | Does                                                            |
| ----------------------------------------- | --------------------------------------------------------------- |
| `$scanWhitespace`                         | Moves `$ptr` over ASCII whitespace (SIMD)                       |
| `$lexIsSpace`, `$lexIsDigit`, `$lexIsHex` | Byte predicates, `(param i32) (result i32)`                     |
| `$lexIsIdentStart`                        | Letter, `_`, `$`, or a byte `>= 0x80`                           |
| `$lexIsNameStart`                         | Same, without `$`                                               |
| `$lexScanIdent`                           | Moves `$ptr` over an identifier                                 |
| `$lexScanNumber`                          | Moves `$ptr` over a number: hex, separators, exponent, suffix   |
| `$lexString(quote, multiline, type)`      | Scans and emits a string at `$ptr`; escapes get `string.escape` |
| `$lexRawString(quote, multiline, type)`   | Same, without escapes                                           |
| `$lexLineComment(skip, type)`             | Emits a comment to the line end; `skip` is the opener length    |
| `$lexBlockComment(skip, type)`            | Emits a comment that ends at `*/`                               |
| `$lexFindByte(p, b)`                      | Returns the address of the next `b` from `p`, or `$end`         |
| `$utf8SpanEnd(e, stop)`                   | Extends `e` to a whole UTF-8 character, clamped to `stop`       |

The four `$lex*String`/`$lex*Comment` helpers continue an open string or comment
in the next chunk of a stream. For other multiline constructs, keep your own
state (see [State](#state-for-streams-and-live-editing)).

## Compiler forms

These forms expand at build time:

| Form                                                      | Use                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `(i32.const "ab")`                                        | Little-endian bytes as an integer; one char = one byte                         |
| `(byte-switch (local.get $c) (case "a" "b" body) ...)`    | `br_table` dispatch on a byte. A case without a branch falls out of the switch |
| `(byteset.get "abc" (local.get $c))`                      | Fast byte-set test                                                             |
| `(memory-region $mem.name size align?)`                   | Static memory; read its address with `(i32.const $mem.name)`                   |
| `(keyword-table $T base end (group value? "w" ...))`      | Perfect-hash keyword table stored in a memory region                           |
| `(keyword-table.get $T lo hi)`                            | 1-based group index, or 0                                                      |
| `(keyword-table.value $T lo hi)`                          | Group value, or -1. Every group needs a value                                  |
| `(const $name value)`, `(enum ...)`, `(func-variant ...)` | Named constants, enums, and constant-folded function copies                    |

Keyword words are 2 to 31 bytes, at most 31 groups per table. If two words share
a hash, the build fails; match one of them directly.

## Example

A config language with `#` and `/* */` comments, strings, numbers, keywords, and
keys:

```wat
(memory-region $mem.confWords 64)
(keyword-table $confWords $mem.confWords $mem.confWords+64
  (group $Token.boolean "true" "false" "on" "off")
  (group $Token.keyword "include" "section"))

(func $highlight
  (local $c i32)
  (local $lhs i32)
  (local $hl i32)
  (block $done
    (loop $next
      (call $scanWhitespace)
      (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
      (local.set $lhs (global.get $ptr))
      (local.set $c (i32.load8_u (global.get $ptr)))
      (block $other
        (byte-switch (local.get $c)
          (case "#"
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next))
          (case "/"
            (br_if $other (i32.ne (i32.load8_u offset=1 (global.get $ptr)) (i32.const "*")))
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next))
          (case "\""
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (br $next))
          (case "=" "[" "]"
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation) (local.get $lhs) (global.get $ptr))
            (br $next))))
      (if (call $lexIsDigit (local.get $c))
        (then
          (call $lexScanNumber)
          (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
          (br $next)))
      (if (call $lexIsIdentStart (local.get $c))
        (then
          (call $lexScanIdent)
          (local.set $hl (enum.get $Token.property))
          (if (i32.ge_s
                (local.tee $c (keyword-table.value $confWords (local.get $lhs) (global.get $ptr)))
                (i32.const 0))
            (then (local.set $hl (local.get $c))))
          (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
          (br $next)))
      ;; unknown byte: keep the UTF-8 character whole
      (global.set $ptr (call $utf8SpanEnd
        (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
      (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
      (br $next))))
```

## State for streams and live editing

`StreamTokenizer`, Markdown fences, and `LiveTokenizer` run the lexer on chunks
or single lines. A lexer that needs context from earlier lines must keep it in
mutable globals or memory regions, and reset it when `$streamReset` is `1`:

```wat
(global $confInSection (mut i32) (i32.const 0))

(func $highlight
  (if (global.get $streamReset)
    (then (global.set $confInSection (i32.const 0))))
  ...)
```

- Locals do not survive between chunks.
- The compiled module saves all your mutable globals and memory regions after
  each line. `LiveTokenizer` stops re-lexing when the saved state equals the old
  one. Keep regions small, and give equal states equal bytes: clear a stack
  entry when you pop it.
- When an open string or comment from a shared helper covers a whole chunk,
  `$highlight` does not run for that chunk.
- `registerLanguages` rejects a lexer that cannot save its state, such as one
  compiled with `transformWat` and `wat2wasm`. Use `buildHighlightsLexer`.

## Rules and pitfalls

- One namespace: do not define `$ptr`, `$end`, or any `$lex*`, `$scan*`,
  `$stream*`, `$sig*`, or `$hl*` name. Prefix your names, such as `$conf*`.
- Shared imports such as `(import "@pierre/wat-tools/common.wat")` are optional.
  Relative imports do not resolve, so keep all code in `wat`.
- Do not declare another memory or hard-code addresses. Use `memory-region`.
- `byte-switch` needs a `(local.get ...)` scrutinee, and each byte in one case.
- `$lexBlockComment` only ends at `*/`. Write your own loop for other closers,
  and keep stream state for it.
- A custom lexer cannot embed another language.
- Unused functions are removed, so extra helpers cost nothing.

## Verify

Compare the same input three ways, with a theme that gives each token type its
own color:

1. `codeToTokens(code, { lang, theme })` on the whole document.
2. `StreamTokenizer` fed in small chunks, such as 1 to 3 bytes.
3. `LiveTokenizer` line tokens, also after edits inside multiline constructs.

All three must give the same tokens. Also test unclosed strings and comments,
non-ASCII text, empty input, and very long lines.
