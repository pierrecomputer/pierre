# Architecture

Highlights lexes UTF-8 in WebAssembly linear memory. Hand-written WAT lexers
emit HTML or binary token records without building an AST. JavaScript handles
input encoding, theme resolution, and themed token objects.

```text
UTF-8 input -> language lexer -> HTML bytes
                             -> byte-end records -> UTF-16 line records
```

WAT lives in `src/`, JavaScript in `lib/`, and the compiler in
[`scripts/build.ts`](./scripts/build.ts). Named addresses live in
[`src/memory.wat`](./src/memory.wat); the first-page map is at the top of
[`src/highlights.wat`](./src/highlights.wat).

| Layer                       | Source                                                              |
| --------------------------- | ------------------------------------------------------------------- |
| Memory, dispatch, languages | `src/highlights.wat`, `src/memory.wat`                              |
| Tokens, scans, HTML/records | `src/token.wat`, `src/scan.wat`, `src/emit.wat`                     |
| Shared scans and lexers     | `src/common.wat`, `src/sig.wat`, `src/langs/*.wat`, `src/embed.wat` |
| Live document               | `src/live.wat`, `lib/live.ts`                                       |
| Host, themes, tokens        | `lib/highlighter.ts`, `lib/theme.ts`, `lib/tokens.ts`               |
| Generated ABI               | `lib/languages.ts`, `lib/token-types.ts` (tracked)                  |

## WAT preprocessing

[`scripts/build.ts`](./scripts/build.ts) expands forms that are not valid WAT.
Local imports share one `$name` namespace; each file is included once and host
imports are hoisted. Comments are stripped first. Enum order is ABI. Use hex
constants for escaped quotes.

| Form                                                                   | Expansion                                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `(import "./token.wat")`                                               | Inline a local module                                                  |
| `(enum $Token "none" ...)`                                             | Sequential IDs; `(enum.get $Token.none)` reads one                     |
| `(language-table (language "name" $lexer "alias" ...) ...)`            | `$Language` IDs, `$hlDispatch`, and the JavaScript name lookup         |
| `(const $mem.name 64)`                                                 | Build-time address                                                     |
| `(css-variable-table ...)`                                             | Kebab-case token names and lookup records                              |
| `(bitset ...)` / `(bitset.get ...)`                                    | Per-enum flag bytes and a load/mask                                    |
| `(i32.const "true")`                                                   | Up to four ASCII bytes packed little-endian; `i64.const` accepts eight |
| `(byteset.get "bytes" (local.get $c))`                                 | Membership test in a shared 256-bit bitmap                             |
| `(enum-map $Name $Enum <base> <default> (value <v> "member" ...) ...)` | Per-enum byte table; `(enum-map.get $Name <expr>)` loads it            |
| `(byte-switch (local.get $c) (case <byte>... body...) ...)`            | `br_table` dispatch; a case without an exit continues after the switch |

### Languages

The `language-table` in [`src/highlights.wat`](./src/highlights.wat) owns each
canonical name, lexer, and aliases. Append new languages to keep IDs stable.
Names are lowercase, unique across the table, and include aliases such as `c++`
and `c#`. At most 256 entries.

The build writes [`lib/languages.ts`](./lib/languages.ts) from this table.
`Lang` is the lookup's literal keys. The file stays tracked so tests typecheck
without a package build; conformance checks it against the WAT. Lexer fixtures
omit the table.

Lexer imports, stream checkpoint participation, and Markdown fence support are
separate lists: several languages share a lexer, and fence support is a subset.

### Keyword tables

```wat
(keyword-table $Name <base> <end> (group <value>? "word" ...) ...)
(keyword-table.get $Name <start> <end>)
(keyword-table.value $Name <start> <end>)
(keyword-pool <base> <end>)
```

The build hashes the first two bytes, last byte, and length, then verifies exact
bytes. `get` returns a 1-based group index or `0`. When every group has a
numeric or `$Token.member[+bias]` value, `value` returns that value or `-1`.

Words are 2–31 bytes and case-sensitive. Words with identical hash inputs cannot
share a table; match one directly, as `rust.wat` does for `where`.
Case-insensitive lexers lowercase ASCII into `$mem.lexLowerScratch` before
lookup. Distinct words share one pool in `src/common.wat`, capped at 8191 bytes.

### Stream checkpoints

Registered stream lexers save loop-carried locals to `$mem.streamState` after a
top-level chunk and restore them after `$lexEmitLeadingContinuation` on the next
chunk. Locals always written before being read are omitted. These lexers cannot
`return`, which would skip the checkpoint.

### Runtime workarounds

The build retains two JavaScriptCore workarounds exercised by
[`test/wasm_test.ts`](./test/wasm_test.ts):

- Functions that transitively call SIMD code receive an unused `v128` local,
  which selects the SIMD calling convention.
- Compound negations `(i32.eqz (i32.and/or ...))` become
  `(i32.shr_u (i32.clz X) (i32.const 5))`.

`optimizeWasm()` reapplies both after Binaryen. `wat2wasm()` enables bulk memory
and SIMD.

## Memory

The first 64 KiB page holds controls, static tables, caches, and lexer scratch.
JavaScript writes language ID (`u8` at 0), output mode (`u8` at 1: 0 inline
HTML, 1 CSS-variable HTML, 2 multi-theme HTML, 3 UTF-16 line records), and input
length (`u32` at 2). Output address and length follow. Non-live input starts at
65536 with a trailing NUL sentinel.

Output starts at `(EOF + 47) & ~15`, leaving SIMD slack and 16-byte alignment.
CSS-variable HTML stores the encoded prefix there and starts output after it;
multi-theme HTML does the same with its packed theme set. `$end` is the scan
boundary: input can contain NUL. Loads may cross `$end`; matches and emitted
ranges must not.

`$ensureCap` grows output before writes. JavaScript rebinds views after growth.
HTML and raw live records are borrowed; copy them before the next operation that
can overwrite or detach memory.

## Themes and HTML

JavaScript prepares each theme once per object identity, resolving every token
slot into per-token styles plus the packed Wasm theme table. Display P3 colors
cannot fit the table, so such a theme has none and instead gets HTML tag
replacements, built on its first HTML render. Syntax scopes resolve through
dot-separated parents, keeping the nearest scope's font settings while searching
for a color. A font-only scope falls back to the theme foreground.

Each token has a five-byte `r g b a style` record. Hex colors accept 3–8 digits;
omitted alpha is `0xff`. Style bit 4 is italic; the low nibble is weight in
hundreds (`0` is default). Slot 0 (`none`) stays empty.

Background is `editor.background ?? background`; foreground is
`editor.foreground ?? text ?? foreground`. Zero records inherit foreground
without a span. Font-only records emit an inherited color with font attributes.

HTML is one `<pre class="highlights" style="..."><code>...</code></pre>`
fragment with inline styles, no token classes or line wrappers. `&`, `<`, and
`>` are escaped. Spans never nest. Equal 40-bit styles merge across whitespace.
CSS-variable mode emits `var(<cssVariablePrefix><token>)`, defaults to `--hls-`,
ignores font settings, and merges only identical token IDs.

Span openers are cached by token ID. Each HTML call compares the padded theme
table and output mode against the cache. A change clears it. CSS-variable
fragments omit the prefix from cached bytes and insert it on output. Token calls
preserve the cache.

A `themes` set renders in one lex. JavaScript packs the set once: one theme
table per member plus each member's escaped custom-property name (`--hls-dark`),
with the `defaultColor` member marked inline. The emitter writes every member
into each span, `color:#…;--hls-dark:#…` with per-member `font-style` and
`font-weight` properties, or merges the `light` and `dark` members into
`light-dark()` values. A token's style is its record in every member, so
neighbors merge only when all members agree, and a token no member styles gets
no span. Openers are cached per set in the span-cache region, used as an arena
with a per-token directory; one that does not fit renders directly. A set call
marks the cache mode so the next single-theme call clears the region, and that
clear invalidates the set's arena in turn. Members with Display P3 or
CSS-variable colors have no theme table, so such a set renders through the
CSS-variable emitter with tag replacements, like a single Display P3 theme. The
host caches up to 128 resolved sets per first theme, allowing discarded partners
and their derived styles and blobs to be collected.

## Emitter contract

`$ptr`, `$end`, and `$eof` track input; `$out`, `$cap`, and `$spanHl` track
output.

- `$hlBegin` reads controls and initializes the driver; HTML mode opens the
  fragment. `$hlEnd` finishes output and publishes its length.
- `$emitTok(hl, lhs, rhs)` emits `[lhs, rhs)`, escaping HTML and merging equal
  styles. Empty ranges do nothing.
- `$emitGap(lhs, rhs)` retains the previous style. Use it for whitespace or
  leading UTF-8 continuation bytes; exclude `&`, `<`, and `>`.
- Token mode writes `(endByte: u32, tokenId: u32)` records. Starts are implicit.
  Equal adjacent IDs and gaps extend the preceding record.
- Mode 3 converts those to `(endUtf16: u32, tokenId: u32)`. ID `0xffffffff`
  marks a line ending and includes its terminator.

Shared scanners leave an already-past cursor unchanged. Every output path
reserves capacity before writing.

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

Embedded lexers temporarily replace `$end` with a subrange, set `$ptr` to its
start, call the language lexer, then restore `$end`. HTML-family lexers record
open script, style, and expression regions for `src/embed.wat` to resume.
Markdown fences retain delimiter, language, and body state; the first body chunk
resets the lexer and later chunks resume it within fence bounds.

## Stream tokenizer

`StreamTokenizer` passes completed UTF-8 byte chunks directly to Wasm. It
decodes each completed chunk once for token contents and UTF-16 offsets;
malformed UTF-8 is normalized before lexing. An owned byte buffer retains
unfinished lines and grows geometrically, so callers can reuse their input
arrays after `pushCode()` returns.

String input keeps its UTF-16 tail and any trailing high surrogate until the
next chunk. This preserves split surrogate pairs and original string content.
When strings and bytes share an unfinished line, only the string prefix needs
encoding before the byte chunk reaches Wasm.

## Live tokenizer

Each `LiveTokenizer` has a dedicated Wasm instance. After the static page, a
size-class heap holds document text, per-line tokens, interned states, and the
line table. Scratch after the heap holds one line, its terminator, a sentinel,
SIMD slack, and record output. The driver copies a line into scratch and runs
the streaming mode-3 pipeline. See [`src/live.wat`](./src/live.wat) for the
heap.

The line table is a gap buffer of descriptors. UTF-16 lengths are stored during
splicing. Records pack as `(tokenId << 24) | endUtf16`, switching to
`[endUtf16, tokenId]` pairs when an end exceeds 24 bits.

Saved states include cross-chunk globals, delimiters, nested fence registers,
active stack prefixes, embedded template state, and lexer checkpoints. Blobs
trim trailing zeros and intern by FNV-1a 64-bit hash plus exact-byte comparison.
Matching state IDs prove convergence.

Edits sharing a line are combined before splicing, preserving the unchanged text
between them so each affected line is rebuilt once per batch. Edits splice
descriptors and retain the old end line's state ID on the last replacement line.
The driver re-tokenizes dirty ranges until outgoing state matches retained
state.

With `renderRange`, synchronous work runs through the range's end, including
preceding dirty lines needed for its state. Completed off-range tokens arrive
through the host callback; the rest run in background slices. `pause` retains
pending work; `flush` finishes it. New edits remap pending dirty ranges through
the batch.

Document text uses WTF-8. CRLF, LF, and lone CR remain intact in text reads;
lexers see normalized line endings.
