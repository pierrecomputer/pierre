# Architecture

chamele highlights code in one pass over WebAssembly linear memory. A
hand-written WAT lexer walks the input and streams either
`<span style="color:#...">` fragments or binary token records to the output. The
lexer builds no AST, token array, or string objects.

```text
UTF-8 input -> selected `$hl*` lexer -> emitter (emit.wat) -> HTML bytes
                                                           -> token records
```

Mode 0 emits inline-color HTML, mode 1 CSS-variable HTML, and mode 2 token
records. JavaScript splits the records at newlines, converts UTF-8 byte offsets
to UTF-16 indexes, and builds Shiki-compatible tokens and HAST for
`codeToTokens`, `codeToHast`, `TokenizeStream`, and `LiveTokenizer`.

## Project structure

```
src/memory.wat      named addresses for static data and scratch memory
src/token.wat       $Token enum, CSS-variable table, and theme-record access
src/scan.wat        read cursors ($ptr/$end/$eof) and SIMD scans
src/emit.wat        HTML/token-record emitter and driver prologue/epilogue
src/common.wat      shared ASCII, identifier, number, string, and comment scans
src/langs/*.wat     29 built-in lexers; aliases share a language id
src/chamele.wat     memory, $Language enum, imports, and dispatch
lib/index.mjs       Highlighter, codeToHtml/codeToTokens/codeToHast, language
                    aliases, theme cache, TokenizeStream, LiveTokenizer
lib/tokens.mjs      token records -> shiki-compatible tokens and hast
lib/theme.mjs       Zed theme -> binary table compiler
lib/token-types.mjs generated, tracked $Token ABI
themes/             bundled, pruned Zed theme objects
scripts/build.mjs   WAT preprocessor and compiler
test/               tests
```

## WAT preprocessor (scripts/build.mjs)

`transformWat()` adds a small source layer over WAT. Its forms are invalid
before preprocessing, so editor warnings are expected.

1. **Imports:** `(import "./token.wat")` inlines each local module once into one
   `$name` namespace. Host imports are hoisted.
2. **Enums:** `(enum $Token "none" ...)` defines sequential indices;
   `(enum.get $Token.none)` inserts one. Order is ABI. Keep parentheses out of
   enum comments.
3. **Addresses:** `(const $mem.name 64)` defines a build-time memory address.
   Definitions live in `src/memory.wat`.
4. **CSS variables:** `(css-variable-table ...)` emits kebab-case token names
   and compact lookup records.
5. **Bitsets:** `(bitset ...)` emits one byte per enum member;
   `(bitset.get ...)` becomes a load and mask.
6. **Character constants:** `(i32.const "true")` packs up to four ASCII bytes
   little-endian; `i64.const` packs eight. Use hex for escaped quotes.

`wat2wasm()` enables bulk memory and SIMD. Hot scans classify 16 bytes with
`i8x16` comparisons, `i8x16.bitmask`, and `i32.ctz`.

## Memory layout

```
[] page 1         (control, static data, and scratch)
  [0]             language id (u8)
  [1]             CSS-variable mode (u8)
  [2:6)           input length (u32 LE)
  [6:10)          output start (u32 LE)
  [10:14)         output length (u32 LE)
  [14:64)         reserved space
  [64:4800)       emitter, token, and lexer tables
  [4800:5824)     shared JSON/TOML/TSX-template stack
  [5824:6848)     TSX bracket-kind stack
  [6848:7872)     theme table written by JavaScript
  [7872:11968)    TSX JSX-mode stack
  [11968:65536)   free
[] pages 2..N     (text buffer)
  [65536:EOF)     input, NUL sentinel, then at least 16 bytes of slack
  [(EOF+47)&~15:) output HTML; $ensureCap grows memory
```

Text buffer layout:

```
↓ input                                          ↓ output
[65536 ............... EOF) [0] [slack.........] [aligned HTML...]
                             ↑
                        NUL sentinel
```

- NUL sentinel: byte 0 is written at EOF. It gives bounded lookahead a safe zero
  byte when reading exactly at the end. The authoritative boundary is still
  $end, because the input itself may contain NUL bytes.
- SIMD slack: SIMD scans load 16 bytes at once. A load beginning near EOF can
  read several bytes beyond the input. Reserved slack keeps those wide reads
  safe and away from output that is already being written.
- 16-byte alignment: the output begins on a multiple-of-16 address, matching
  SIMD load/store width. WebAssembly permits unaligned access, but alignment
  gives a cleaner, potentially faster layout.

Formula: `(EOF + 47) & ~15`

## Theme table

`$Token` uses Zed capture names. For each capture, JavaScript selects the
longest dot-boundary prefix in `theme.style.syntax` (`function.method` →
`function`).

Each token gets a five-byte record at 6848: `r g b a style`. Colors must be
`#rrggbb` or `#rrggbbaa`; omitted alpha is `0xff`. Style bit 4 means italic, and
the low nibble holds `font_weight / 100` (0 means default). Entries without a
color remain zero, including their font settings.

`background` and `foreground` resolve from
`style.editor.background ?? style.background` and
`style.editor.foreground ?? style.text ?? style.foreground`. Slot 0 (`none`)
stays empty. Any zero record inherits the `<pre>` foreground without a span.

The emitter writes lowercase `#rrggbb`, adds alpha only when non-opaque, and
appends font attributes. It compares 40-bit records to merge equal styles.
CSS-variable mode bypasses the table, emits `var(--cha-<token>)`, and merges
only identical token types.

## Emitter contract (src/emit.wat, src/scan.wat)

`$ptr`, `$end`, and `$eof` track input. `$out`, `$cap`, and `$spanHl` track
output and the open span.

- `$hlBegin` reads the control block, sets cursors, and opens `<pre><code>`.
  `$hlEnd` closes it and publishes the output length. Entrypoints and test
  harnesses call both.
- `$emitTok(hl, lhs, rhs)` emits `[lhs,rhs)` in style `hl`, grows memory,
  escapes `& < >`, and merges spans. Empty ranges do nothing.
- `$emitGap(lhs, rhs)` emits whitespace without changing the span, letting equal
  styles merge across gaps.
- In token-record mode both write `(end: u32, hl: u32)` records instead
  (`$recTok`): a record's start is the previous record's end, so the records
  tile the input; same-`hl` neighbors and gaps extend the previous record, the
  analog of span merging. Offsets are relative to the input start, and the JS
  glue resolves colors, so no theme table is written.
- `$scanToLineEnd`, `$scanBlockCommentEnd`, and `$scanHexRun` provide bounded
  comment and hexadecimal scans.
- `$scanFindSpecial`, `$scanWhitespace`, `$scanIdentRun`, and `$utf8SpanEnd`
  scan strings, whitespace, identifiers, and escape spans. They leave an
  already-past cursor unchanged; moving it backward could duplicate bytes after
  a split-range scan.
- `$ensureCap(n)` grows output memory. Every output path reserves space before
  writing.

## Language lexer contract (src/langs/\*.wat)

A `$hl<Language>` lexer scans `[$ptr, $end)` and returns with `$ptr == $end`.

- **Lossless**: every input byte is emitted exactly once, in order, via
  `$emitTok`/ `$emitGap`. Stripping tags and decoding entities restores the
  exact input.
- **Total**: malformed input neither traps nor loops. Each iteration advances
  `$ptr`; unterminated constructs run to `$end`.
- **Bounded**: never emit past `$end`. Top-level scans use `$end == $eof`;
  embedded scans use subranges. Check `$ptr >= $end`, not the sentinel. SIMD
  loads may cross `$end` into slack, but matches must be discarded and `$ptr`
  clamped.
- **Reusable**: initialize local state on entry and keep stacks inside assigned
  scratch ranges.
- Emit inter-token whitespace with `$emitGap`; batch runs of plain bytes into
  one `$emitTok(none, ...)`.

An embedded lexer uses a bounded subrange:

```wat
;; highlight [from,to) as TSX, then continue after it
(local.set $save (global.get $end))
(global.set $end (local.get $to))
(global.set $ptr (local.get $from))
(call $hlTsx)
(global.set $end (local.get $save))
;; $ptr == $to here
```

## Token conventions

Lexers emit Zed capture names from `$Token`, guided by Zed highlight queries.
Main conventions:

| Input           | Captures                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Common code     | `comment`, `comment.doc`, `string`, `string.escape`, `number`, `keyword*`, `operator`, `function*`, `property`, `type*`, `variable*` |
| TSX literals    | Templates use `string`, `string.escape`, and `punctuation.special`; regex uses `string.regex`                                        |
| TSX names       | Calls use `function*`; members use `property`; decorators use `attribute`; uppercase names use `type` or `constant`                  |
| JSDoc           | `keyword.jsdoc`, `type.jsdoc`, and `variable.jsdoc`                                                                                  |
| JSX             | `punctuation.*.jsx`, `tag.jsx`, `tag.component.jsx`, `attribute.jsx`, and `text.jsx`                                                 |
| HTML/XML        | `punctuation.*.html`, `tag`, `tag.doctype`, `attribute`, `string`, and `string.special`                                              |
| CSS             | `selector.*`, `namespace`, `tag`, `attribute`, `property`, `variable`, `function`, `constant.builtin`, and `string.special`          |
| JSON            | Object keys use `property.json_key`; values use `string`, `number`, `boolean`, and `constant.builtin`                                |
| TOML            | Keys use `property`; dates use `string.special`; booleans and infinities use `constant`; numbers use `number`                        |
| YAML            | Keys use `property`; anchors, aliases, tags, and markers use `type` or `punctuation.special`                                         |
| Markdown/MDX    | `title`, `emphasis*`, `link_text`, `link_uri`, `punctuation.list_marker`, `punctuation.markup`, and `text.literal`                   |
| Markdown fences | Supported info strings delegate to a bounded lexer; unknown languages stay `text.literal`                                            |
| Assembly/WAT    | Mnemonics or forms use `keyword`; registers and names use `variable*`; directives use `preproc`                                      |
| Diff            | Payload uses `diff.plus` or `diff.minus`; metadata uses contextual captures                                                          |

Language-specific lexers add captures such as C-family `preproc`, SQL
`keyword.operator`, and Zig `keyword.import`. These are token-stream heuristics,
not parses. TS type positions, parameters, embedded boundaries, and exact query
fidelity are out of scope. TSX uses capitalization for some types and constants;
JSDoc names use `variable.jsdoc`.

## Output shape

Output is one self-contained fragment:

```html
<pre class="chamele" style="background-color:BG;color:FG"><code>...</code></pre>
```

It uses inline styles, with no token classes or line spans. Only `& < >` are
escaped. Spans never nest. Adjacent equal styles merge across whitespace.
