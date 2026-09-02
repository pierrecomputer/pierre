# Architecture

chamele uses WebAssembly linear memory throughout highlighting. A hand-written
WAT lexer walks the input and streams either `<span style="color:#...">`
fragments or binary token records to the output. The lexer builds no AST, token
array, or string objects.

```text
UTF-8 input -> selected `$hl*` lexer -> emitter (emit.wat) -> HTML bytes
                                                           -> byte-end token records
                                                           -> UTF-16 line records
```

## Project structure

```
src/memory.wat      named addresses for static data and scratch memory
src/token.wat       $Token enum, CSS-variable table, and theme-record access
src/scan.wat        read cursors ($ptr/$end/$eof) and SIMD scans
src/emit.wat        HTML/token-record emitter and driver prologue/epilogue
src/common.wat      shared ASCII, identifier, number, string, and comment scans
src/sig.wat         shared parameter-list machine (variable.parameter)
src/langs/*.wat     32 built-in language modes
src/live.wat        incremental-tokenizer core: heap, line table, state
                    interning, per-line driver, edit splicing, compaction
src/chamele.wat     memory, $Language enum, imports, and dispatch
lib/index.ts        public types and the export barrel
lib/highlighter.ts  WasmHighlighter, codeToHtml/codeToTokens/codeToHast,
                    language aliases, theme cache, TokenizeStream
lib/live.ts         LiveTokenizer glue: edit validation, WTF-8 encoding,
                    deferred slicing, themed reads over the live exports
lib/tokens.ts       token records -> shiki-compatible tokens and hast
lib/theme.ts        Zed theme -> binary table compiler
lib/token-types.ts  generated, tracked $Token ABI
themes/             bundled, pruned Zed theme objects; index.ts re-exports
                    them typed and compiles to a self-contained dist/themes.js
scripts/build.ts    WAT preprocessor and compiler; writes the wasm artifacts
                    into dist/, where tsdown also compiles the lib/ glue
test/               tests (bun test)
```

## WAT preprocessor (scripts/build.ts)

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
7. **Keyword tables:**
   `(keyword-table $Name <base> <end> <buckets> <slots> (group "word" ...) ...)`
   emits a displacement-based perfect hash over (first two bytes, last byte,
   length) with exact-byte verification;
   `(keyword-table.get $Name <start> <end>)` returns the 1-based group index
   or 0. Words are 2..31 bytes, matched case-sensitively. Two words sharing
   first two bytes, last byte, and length collide unfixably - keep one out of
   the table and match it directly (see rust.wat's `where`). Never spell a form
   name inside parentheses in a comment; the matchers do not skip comments.

`wat2wasm()` enables bulk memory and SIMD. Hot scans classify 16 bytes with
`i8x16` comparisons, `i8x16.bitmask`, and `i32.ctz`.

## Memory layout

```
[] page 1         (control, static data, and scratch)
  [0]             language id (u8)
  [1]             output mode (u8): HTML, CSS variables, byte records, or line records
  [2:6)           input length (u32 LE)
  [6:10)          output start (u32 LE)
  [10:14)         output length (u32 LE)
  [14:64)         reserved space
  [64:4800)       emitter, token, and lexer tables
  [4800:5824)     shared JSON/TOML/ECMAScript-template stack
  [5824:6848)     ECMAScript bracket-kind stack
  [6848:7872)     theme table written by JavaScript
  [7872:11968)    JSX-mode stack
  [11968:12000)   streaming delimiter
  [12000:16000)   streaming lexer checkpoints
  [16000:26752)   keyword-table region (see src/memory.wat)
  [26752:31570)   span-open fragment cache (HTML modes)
  [31584:31712)   live free-list heads
  [31712:65536)   free
[] pages 2..N     (text buffer)
  [65536:EOF)     input, NUL sentinel, then at least 16 bytes of slack
  [(EOF+47)&~15:) output HTML or token records; $ensureCap grows memory
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
- In mode 2 both write `(endByte: u32, hl: u32)` records instead (`$recTok`): a
  record's start is the previous record's end, so the records tile the input;
  same-`hl` neighbors and gaps extend the previous record, the analog of span
  merging. Offsets are relative to the input start, and the JS glue resolves
  colors, so no theme table is written.
- Mode 3 first emits the same byte records to preserve lexer emission order. At
  `$hlEnd`, a post-pass scans the covered input once and emits
  `(endUtf16: u32, hl: u32)` records. Token id `0xffffffff` marks a line ending
  and includes its LF or CRLF terminator. JavaScript can then build each line's
  tokens or HAST runs without byte conversion or substring searches.
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

## HTML output shape

Output is one self-contained fragment:

```html
<pre class="chamele" style="background-color:BG;color:FG"><code>...</code></pre>
```

It uses inline styles, with no token classes or line spans. Only `& < >` are
escaped. Spans never nest. Adjacent equal styles merge across whitespace.

## Live tokenizer (src/live.wat, lib/live.ts)

A `LiveTokenizer` instance is a dedicated Wasm instance whose text pages hold
the whole editor document instead of a one-shot input buffer:

```
[] page 1                     control, static data, live free-list heads
[] [65536:81920)              line-change list: count, then 16-byte entries
[] [86016:heap ceiling)       size-class heap: document text blocks, per-line
                              token blocks, interned state blobs, line table
[] [heap ceiling:memory end)  transient per-line scratch: the line's bytes,
                              terminator, NUL sentinel, SIMD slack, then the
                              standard aligned record output
```

Each line is copied into scratch with its terminator. `$srcBase` points at it,
then `$streamChunk` runs the ordinary mode-3 pipeline. Output matches
`TokenizeStream` fed one line per chunk.

Before and after each line the driver saves streaming state: cross-chunk
globals, the 32-byte stream delimiter, the used lexer checkpoint region, and the
live prefixes of the shared/bracket/jsx stacks. Blobs are interned (FNV-1a 64,
then exact bytes) into refcounted ids. Equal ids mean convergence. Trailing
zeros are trimmed. If outgoing bytes match the incoming blob, the same id is
reused without hashing.

The line table is a gap buffer of 32-byte descriptors: text pointer/length,
UTF-16 length, token block, outgoing state id, terminator and format flags.
Token records pack as `(tokenId << 24) | endUtf16`, or `[endUtf16, tokenId]`
once the id exceeds 24 bits.

Edits splice descriptors. The last replacement line keeps the old end line's
state id. The driver re-tokenizes dirty ranges until a line's new outgoing id
matches its old one, and reports every re-tokenized line.

Driver state is all globals, so `liveRun` can stop at a line budget. With a
`renderRange`, JavaScript runs until the cursor passes the range, returns those
tokens, and continues in background slices via `onDeferTokenize`. Slice lines
come from the change list plus the driver cursor (`liveStats` keys 10/11).
`pause` holds slices without dropping them.

A new edit does not wait for pending slices. `liveApplyEdits` remaps unreached
dirty ranges through the batch splices and merges them into the new range list.
Lines the old run never reached still get re-tokenized; beyond that, matching a
pre-old-batch state id is enough to stop.

The heap is size-class free lists (8-byte headers, one size per class), no
coalescing. Compaction slides live blocks when parked free space exceeds live
data by at least 1 MiB.

Text is WTF-8. JavaScript encodes lone surrogates; edits that split an astral
pair synthesize the matching halves. `getLineText` round-trips any UTF-16
document.
