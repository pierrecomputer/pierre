# Architecture

Highlights lexes UTF-8 in WebAssembly linear memory. Hand-written WAT lexers
emit HTML or binary token records without building an AST. JavaScript handles
input encoding, theme resolution, and themed token objects.

```text
UTF-8 input -> language lexer -> HTML bytes
                             -> byte-end records -> UTF-16 line records
```

## Source map

| Source               | Responsibility                                         |
| -------------------- | ------------------------------------------------------ |
| `src/highlights.wat` | Memory, language IDs, host imports, dispatch           |
| `src/memory.wat`     | Static addresses and scratch regions                   |
| `src/token.wat`      | Token IDs, CSS-variable names, theme access            |
| `src/scan.wat`       | Input cursors and SIMD scans                           |
| `src/emit.wat`       | HTML, token records, driver setup and teardown         |
| `src/common.wat`     | Shared identifier, number, string, and comment scans   |
| `src/sig.wat`        | Parameter-list classification                          |
| `src/langs/*.wat`    | Language lexers                                        |
| `src/embed.wat`      | Resumption of embedded languages                       |
| `src/live.wat`       | Document heap, line table, state interning, edits      |
| `lib/index.ts`       | Public types and exports                               |
| `lib/highlighter.ts` | Wasm instances, aliases, input, themes, streaming      |
| `lib/live.ts`        | Edit validation, WTF-8 text, deferred work, live reads |
| `lib/tokens.ts`      | Token records to themed objects                        |
| `lib/theme.ts`       | Theme resolution and binary compilation                |
| `lib/token-types.ts` | Generated token ABI, tracked in git                    |
| `themes/`            | Theme JSON, named exports, CSS conversion              |
| `scripts/build.ts`   | WAT preprocessing, compilation, generated artifacts    |
| `test/`              | Bun tests, including lexer and Wasm conformance        |

## WAT preprocessing

[`scripts/build.ts`](./scripts/build.ts) adds forms that are not valid WAT until
`transformWat()` expands them. Local imports share one `$name` namespace; each
file is included once and host imports are hoisted. Comments are stripped before
forms are expanded.

| Form                                                                   | Expansion                                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `(import "./token.wat")`                                               | Inline a local module                                                  |
| `(enum $Token "none" ...)`                                             | Sequential IDs; `(enum.get $Token.none)` reads one                     |
| `(const $mem.name 64)`                                                 | Build-time address                                                     |
| `(css-variable-table ...)`                                             | Kebab-case token names and lookup records                              |
| `(bitset ...)` / `(bitset.get ...)`                                    | Per-enum flag bytes and a load/mask                                    |
| `(i32.const "true")`                                                   | Up to four ASCII bytes packed little-endian; `i64.const` accepts eight |
| `(byteset.get "bytes" (local.get $c))`                                 | Membership test in a shared 256-bit bitmap                             |
| `(enum-map $Name $Enum <base> <default> (value <v> "member" ...) ...)` | Per-enum byte table; `(enum-map.get $Name <expr>)` loads it            |
| `(byte-switch (local.get $c) (case <byte>... body...) ...)`            | `br_table` dispatch; a case without an exit continues after the switch |

Enum order is ABI. Static addresses live in
[`src/memory.wat`](./src/memory.wat). Use hex constants for escaped quotes.

### Keyword tables

```wat
(keyword-table $Name <base> <end> (group <value>? "word" ...) ...)
(keyword-table.get $Name <start> <end>)
(keyword-table.value $Name <start> <end>)
```

The build creates a displacement-based perfect hash from the first two bytes,
last byte, and length, then verifies exact bytes. `get` returns a 1-based group
index or `0`. When every group has a numeric or `$Token.member[+bias]` value,
`value` returns that value or `-1`.

Words are 2–31 bytes and case-sensitive. Words with identical hash inputs cannot
share a table; match one directly, as `rust.wat` does for `where`. Verification
uses one SIMD vector up to 16 bytes and two overlapping vectors for longer
words. Short comparisons mask bytes after the word, so table entries and
lowercase scratch copies need no zero padding. Case-insensitive lexers lowercase
ASCII before lookup.

### Stream checkpoints

The registered stream lexers save loop-carried locals to `$mem.streamState`
after a top-level chunk and restore them after `$lexEmitLeadingContinuation` on
the next chunk. Liveness analysis excludes locals always written before being
read. These lexers cannot use `return`, which would skip the checkpoint.

### Runtime workarounds

The build retains two JavaScriptCore workarounds exercised by
[`test/wasm_test.ts`](./test/wasm_test.ts):

- Functions that transitively call SIMD code receive an unused `v128` local.
  This selects the SIMD calling convention and avoids ARM64 vector-register
  corruption observed after scanner inlining in Bun 1.4.
- Compound negations, `(i32.eqz (i32.and/or ...))`, become
  `(i32.shr_u (i32.clz X) (i32.const 5))`. The result stays 0 or 1 while
  avoiding a conditional-compare optimization that corrupted branch flags in Bun
  1.4.

`optimizeWasm()` reapplies both passes after Binaryen, which can undo them.
`wat2wasm()` enables bulk memory and SIMD.

## Memory

The first 64 KiB page contains controls, static tables, caches, and lexer
scratch. [`src/memory.wat`](./src/memory.wat) defines the full layout.

| Byte range     | Content                                                                |
| -------------- | ---------------------------------------------------------------------- |
| `[0, 1)`       | Language ID (`u8`)                                                     |
| `[1, 2)`       | Output mode: 0 inline HTML, 1 CSS-variable HTML, 3 UTF-16 line records |
| `[2, 6)`       | Input byte length (`u32`, little-endian)                               |
| `[6, 10)`      | Output address (`u32`, little-endian)                                  |
| `[10, 14)`     | Output byte length (`u32`, little-endian)                              |
| `[64, 448)`    | Theme table, padded for SIMD comparisons                               |
| `[65536, EOF)` | Input for a non-live call                                              |

A NUL sentinel follows the input. Output starts at `(EOF + 47) & ~15`, leaving
slack for 16-byte SIMD loads and aligning output to 16 bytes. `$end` remains the
authoritative scan boundary because input can contain NUL. Loads may cross a
scan boundary, but matches and emitted ranges must stay within it.

`$ensureCap` grows output memory before writes. JavaScript rebinds its views
after growth. HTML and raw live records are borrowed views; callers must copy
them before operations that can overwrite or detach their memory.

## Themes and HTML

JavaScript caches compiled styles by theme object identity. Syntax scopes
resolve through dot-separated parents, keeping the nearest scope's font settings
while searching for a color. A font-only scope falls back to the theme
foreground.

Each token has a five-byte `r g b a style` record. The compiler accepts `#rgb`,
`#rgba`, `#rrggbb`, and `#rrggbbaa`; omitted alpha is `0xff`. Style bit 4 means
italic, and the low nibble holds the weight in hundreds (`0` means default).
Slot 0 (`none`) stays empty. Font settings can remain present without a color.

Background resolves as `editor.background ?? background`; foreground resolves as
`editor.foreground ?? text ?? foreground`. Zero records inherit foreground
without a span. Font-only records emit an inherited color with font attributes.

HTML is one `<pre class="highlights" style="..."><code>...</code></pre>`
fragment. It has inline styles, no token classes or line wrappers, and escapes
`&`, `<`, and `>`. Spans never nest. Equal 40-bit styles merge across
whitespace. CSS-variable mode emits `var(--hls-<token>)`, ignores font settings,
and merges only identical token IDs.

Span openers are cached by token ID. Each HTML call compares the padded theme
table and output mode against the cache, including changes written directly to
Wasm memory. A change clears the span cache. Token calls preserve the cache and
skip theme comparison.

## Emitter contract

`$ptr`, `$end`, and `$eof` track input; `$out`, `$cap`, and `$spanHl` track
output.

- `$hlBegin` reads controls and initializes the driver; HTML mode opens the
  fragment. `$hlEnd` finishes output and publishes its length.
- `$emitTok(hl, lhs, rhs)` emits `[lhs, rhs)`, escaping HTML and merging equal
  styles. Empty ranges do nothing.
- `$emitGap(lhs, rhs)` retains the previous style. Use it for whitespace or
  leading UTF-8 continuation bytes; callers must exclude `&`, `<`, and `>`.
- Token mode writes `(endByte: u32, tokenId: u32)` records. Starts are implicit:
  each record begins at the previous end. Equal adjacent IDs and gaps extend the
  preceding record.
- Mode 3 converts byte records to `(endUtf16: u32, tokenId: u32)` in a final
  scan. ID `0xffffffff` marks a line ending and includes its terminator.
  JavaScript builds line tokens without searching substrings or converting byte
  offsets.

Shared scanners leave an already-past cursor unchanged; moving it backward could
duplicate bytes after a bounded scan. Every output path reserves capacity before
writing.

## Lexer contract

A `$hl<Language>` lexer scans `[$ptr, $end)` and returns with `$ptr == $end`.

- Emit every byte exactly once, in order, through `$emitTok` or `$emitGap`.
- Advance on every iteration, including malformed input. Unterminated constructs
  stop at `$end`.
- Check `$ptr >= $end`, not the sentinel. Discard SIMD matches beyond the range
  and clamp the cursor.
- Initialize fresh state on a non-resuming entry and use assigned scratch
  regions for stacks.
- Emit inter-token whitespace with `$emitGap` and batch unstyled bytes into one
  `$emitTok(none, ...)` call.

Embedded lexers temporarily replace `$end` with a subrange boundary, set `$ptr`
to its start, call the language lexer, then restore `$end`. HTML-family lexers
record open script, style, and expression regions for `src/embed.wat` to resume.
Markdown fences retain their delimiter, language, and body state; the first body
chunk resets the lexer and later chunks resume it within fence bounds.

## Live tokenizer

Each `LiveTokenizer` has a dedicated Wasm instance. After the static page, a
size-class heap holds document text, per-line tokens, interned states, and the
line table. Scratch after the heap holds one line, its terminator, a sentinel,
SIMD slack, and record output. The driver copies a line into scratch and runs
the streaming mode-3 pipeline.

The line table is a gap buffer of 32-byte descriptors: text pointer and length,
UTF-16 length, token block, outgoing state ID, and terminator/format flags.
Records pack as `(tokenId << 24) | endUtf16`, switching to `[endUtf16, tokenId]`
pairs when an end exceeds 24 bits. UTF-16 lengths are stored during splicing, so
text reads and edit validation do not wait for tokenization.

Saved states include cross-chunk globals, delimiters, nested fence registers,
active stack prefixes, embedded template state, and lexer checkpoints. Blobs
trim trailing zeros and are interned by FNV-1a 64-bit hash plus exact-byte
comparison. Matching state IDs prove convergence. Unchanged outgoing bytes reuse
the incoming ID without hashing.

Edits splice descriptors and retain the old end line's state ID on the last
replacement line. The driver re-tokenizes dirty ranges until outgoing state
matches retained state. The change list holds 1,000 coalesced ranges; overflow
merges into the last range, which can then include unchanged lines.

With `renderRange`, synchronous work runs through the range's end, including
preceding dirty lines needed to determine its state. JavaScript returns the
in-range tokens, delivers completed off-range tokens, and schedules the rest in
background slices. `pause` retains pending work; `flush` finishes it. New edits
remap pending dirty ranges through the batch and merge them with new work.

The heap uses size-class free lists with 8-byte headers and no coalescing.
Compaction moves live blocks when retained free space exceeds live data and
reaches at least 1 MiB.

Document text uses WTF-8 to preserve every UTF-16 code unit, including lone
surrogates and edits that split surrogate pairs. CRLF, LF, and lone CR remain
intact in text reads; lexers see normalized line endings.
