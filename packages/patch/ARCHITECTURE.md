# Architecture

`@pierre/patch` makes text diffs that match jsdiff. All diff logic is in WAT.
Each call tokenizes both texts, interns each token to a dense integer id, runs
jsdiff's Myers O(ND) algorithm on the two id arrays, and then writes compact
change records (`$emitRecords`) or unified diff text (`$emitPatch`).

```
WTF-8 old+new -> tokenize -> intern ids -> $myers -> $emitRecords | $emitPatch
```

## jsdiff compatibility

The output must be **byte-identical to `diff@9.0.0`**, lone surrogates included.
Tests fuzz every API against it. A correct diff is not enough. The code must
make the same choices as jsdiff:

- **Tokenizers.** `diffChars` splits like `Array.from` (code points).
  `diffWordsWithSpace` uses `(\r?\n)|[word]+|[^\S\n\r]+|[^word]` with jsdiff's
  `extendedWordChars` ranges. `diffLines` splits after each `\n`.
- **Line options.** `ignoreWhitespace` compares lines as
  `left.trim() === right.trim()`, and a common line keeps the new text.
  `stripTrailingCr` replaces each `\r\n` with `\n` before the diff.
- **Myers.** Keep jsdiff's tie-break:
  `!canRemove || (canAdd && removePath.oldPos < addPath.oldPos)`. Keep its
  diagonal pruning (`minDiagonalToConsider` / `maxDiagonalToConsider`): compute
  `kEnd` in every iteration, but `kStart` only once for each edit length. Keep
  the component merge of `addToPath` and `extractCommon`.
- **Hunks.** Group like `structuredPatch`. Context lines come only from the
  previous common component. Two hunks merge when
  `lines.length <= context*2 && i < diff.length - 2`. Add the trailing sentinel
  and `\ No newline at end of file`. A side with 0 lines shows its start one
  lower.

## Change records

A token is one contiguous byte range, and equal tokens have equal bytes. So each
change value is one range of the old text (removed) or the new text (common,
added), as in jsdiff. The change-record APIs never copy token text. Wasm writes
one 16-byte record for each change:

- `flags`: `0` common, `1` removed, `2` added
- `count`: number of tokens
- `start`, `end`: UTF-16 offsets into the old text (removed) or the new text
  (common, added)

`$emitRecords` changes byte offsets to UTF-16 offsets in one SIMD pass, and
skips a side that is pure ASCII. The host slices the original JS strings, so it
never decodes a value. With `ignoreWhitespace`, the two sides of a common run
can have different bytes, so the old side counts its own UTF-16 units.

## Project structure

```
src/mem.wat       memory layout map, bump allocator, errors, itoa, memcmp, token hash,
                  SIMD memchr
src/tokenize.wat  WTF-8 decoder, character classes, the three tokenizers, interning
src/myers.wat     jsdiff Myers loop, component list, change records
src/patch.wat     ENTRY module: op dispatch, hunk grouping, patch headers, unified diff text
lib/core.ts       host glue: init(module), diffChars, diffWordsWithSpace, diffLines,
                  createPatch, createTwoFilesPatch
lib/index.ts      Node, Deno, Bun, browsers: wasm bytes inlined in dist/patch.wasm.mjs
lib/workerd.ts    Cloudflare Workers: native wasm import
scripts/build.ts  WAT preprocessor + wat2wasm + binaryen (tests and bench import it too)
test/             bun:test: tokenizer and size-limit harnesses, API tests, fuzz against diff@9.0.0
benchmark/        throughput and memory against diff@9.0.0, fixed-seed fixtures
```

## Build

`scripts/build.ts` has three steps:

1. `transformWat()` inlines `(import "./x.wat")` modules (each file once) and
   changes string operands such as `(i32.const "@@ -")` to little-endian
   integers.
2. `wat2wasm()` compiles with wabt, with bulk memory and SIMD on.
3. `optimizeWasm()` runs binaryen `-O3 --shrink-level=1` three times with the
   optimized Stack IR writer. Each pass can fold patterns that the previous pass
   exposed.

`moonx patch:build` runs it, then tsdown. It writes `dist/patch.wat` (debug),
`dist/patch.wasm`, and `dist/patch.wasm.mjs` (base64 bytes for browsers) next to
the compiled glue, and writes the wasm sizes to `meta` in `package.json`. Git
ignores `dist/`.

## Memory layout

```
[] page 1         (control + static data)
  [0]             op (u8): 1 = diffChars, 2 = diffWordsWithSpace,
                  3 = unified-patch hunks (line tokens), 4 = diffLines
  [1]             output flag (u8): 0 = error, 1 = success
  [2]             patch header flags (op 3 input): includeIndex, includeUnderline,
                  includeFileHeaders, oldFileName/newFileName defined
  [3]             input flags: bit 0/1 old/new text is pure ASCII (op 1/2/4),
                  bit 2 ignoreWhitespace (op 3/4)
  [4:8)           old text length (u32 LE)
  [8:12)          new text length (u32 LE)
  [12:16)         change-record count (op 1/2/4) / error message length
  [16:20)         result pointer: change records, patch text, or error message
  [20:24)         patch text length (op 3)
  [24:28)         context line count (op 3 input)
  [28:44)         filename/header byte lengths (4 × u32, op 3 input)
  [64:192)        ASCII word/space class table for the word tokenizer
  [1024:1083)     static strings, packed gap-free (error messages, the
                  no-newline marker, C escape letters)
  [1083:1093)     $itoa digit scratch
[] page 2..N      (text buffer)
  [65536:oldEnd)  old text (WTF-8)
  [oldEnd:newEnd) new text
  [newEnd:EOF)    op 3: oldFileName, newFileName, oldHeader, newHeader
  [EOF:EOF+16)    pad so 16-byte SIMD scans may overread safely
  [EOF+16:...)    bump-allocated workspace
```

`$alloc` is a bump allocator. It grows memory by itself with 25% extra, so small
allocations do not grow one page at a time. If memory cannot grow, it reports
`out of memory` and does not trap. Each call allocates in this order:

1. Token offset arrays (at most one token for each byte).
2. The intern table: 12-byte open-addressing slots, load factor ½ or less.
   `diffChars` has no intern table.
3. Token id arrays.
4. `bestPath` diagonals.
5. Component nodes.
6. The flat component array, then the change records, or the hunk descriptors
   and the patch text.

Nothing is freed. The next call starts the workspace again after its own input.

## Interning and the hot loop

jsdiff compares token _strings_ in its inner loop. Here, words and lines intern
once, with a chunked multiply-mix hash and a byte compare to confirm each match.
After that, `extractCommon` (`$scanCommon`) compares dense i32 ids. With
`ignoreWhitespace`, a line interns by its range without leading and trailing
`trim()` whitespace, so lines that differ only there get the same id. All
whitespace-only lines key as one empty range.

Almost all diff time is in this loop. It compares 4 ids per step with `i8x16.eq`
and `i8x16.bitmask`, also for the last partial chunk. That chunk can read up to
12 bytes past the id array. Those bytes are in later allocations, and the loop
clamps the count.

- `diffChars` does not intern. The code point _is_ the id. An invalid UTF-8 byte
  gets the id `0x110000 + byte`, which is above the Unicode range, so it never
  matches a real character. A lone surrogate decodes to its code unit
  (`0xD800..0xDFFF`). Pure-ASCII runs tokenize 16 code points per SIMD step.
- The word tokenizer reads the class of each ASCII byte from the page-1 class
  table. It decodes UTF-8 only for lead bytes ≥ 0x80.
- The line tokenizer finds each `\n` with SIMD `memchr`.

## Myers state

- `bestPath` is jsdiff's sparse diagonal array. Each entry is 8 bytes:
  `(oldPos, lastComponent)`. `0x80808080` means "undefined". Entries are cleared
  lazily: edit length d reads only two new entries, `[-(d+1)]` and `[d+1]`. So
  setup costs O(D), like jsdiff's sparse array, not O(M+N).
- A component node is 8 bytes: `(prev, count | added<<31 | removed<<30)`. Nodes
  are bump-allocated. Paths share nodes and never change them, like jsdiff's
  linked objects. Worst-case memory is O(D²), as in jsdiff, but each node is 8
  bytes, not a JS object.

## Patch emission (op 3)

`$patchHunks` reads the components once. It runs the `structuredPatch` state
machine and writes one 32-byte descriptor for each hunk: the four `@@` numbers
and the span `(startComp, startOff, endComp, endOff)`. It needs no token
cursors: a line counter moves only when the token cursor of its side moves, so
each 1-based `@@` start is that cursor + 1.

A second pass writes each hunk:

1. `$itoa` writes the numbers of the `@@` line.
2. Each line is one prefix byte (`-`, `+`, or space), then one `memory.copy` of
   the token.
3. If a token does not end in `\n`, the pass adds `\ No newline at end of file`.

Each line keeps its own trailing `\n`. This gives the same bytes as jsdiff,
which strips the newlines and then does `join('\n') + '\n'`. So a patch with no
lines (no header lines and no hunks) is `"\n"`.

Wasm also writes the header lines (`$emitHeaders` and `$quoteName` in
`src/patch.wat`):

- `Index: <oldFileName>`: when `includeIndex` is on, and both filenames are
  defined and byte-equal.
- `===` underline (67 `=`, one `memory.fill`): when `includeUnderline` is on.
- `--- <old>` and `+++ <new>`: when `includeFileHeaders` is on and both
  filenames are defined. Names are quoted in the Git style (C escapes). jsdiff
  quotes UTF-8 bytes too, so the byte-level port is exact. jsdiff gets those
  bytes from `TextEncoder`, so a lone surrogate is quoted as U+FFFD
  (`\357\277\275`). A truthy header adds `\t<header>` to its line.

The host writes the four strings after the new text, their byte lengths at
`[28:44)`, and the flags at `[2]`. Then it decodes one finished string.

## Host glue (`lib/core.ts`)

- **Write input.** Grow memory for the worst case (3 bytes for each UTF-16 unit,
  plus 64), then `TextEncoder.encodeInto`. If `isWellFormed()` is false, the
  host writes WTF-8: `encodeInto` for each run between lone surrogates, and
  `ED A0..BF xx` for each lone surrogate. `TextEncoder` would write U+FFFD, and
  then `"\uD800"`, `"\uD801"`, and `"\uFFFD"` would be equal tokens. jsdiff
  compares UTF-16, so they are different.
- **Read change values.** `String.slice` of the inputs with the UTF-16 offsets
  from the records. No decode.
- **Read patch text and errors.** `TextDecoder` with `ignoreBOM: true`. The
  default decoder strips a leading U+FEFF. If an input had a lone surrogate, the
  host finds each `ED A0..BF xx` in the patch text, decodes the bytes between
  them, and puts back each code unit, as jsdiff does.
- **Check options.** `diffChars` and `diffWordsWithSpace` accept no options.
  `diffLines` accepts `ignoreWhitespace` and `stripTrailingCr`. The patch
  functions also accept `context` (a non-negative integer or `Infinity`) and
  `headerOptions`. Any other option that is on, or a callback, throws. An option
  set to `undefined`, `null`, or `false` is off, as in jsdiff. No
  `headerOptions` turns on every header line, and a field left out of the object
  is false.
- **Strip CRs.** `stripTrailingCr` is `replaceAll("\r\n", "\n")` on both texts
  before they are written, so change values slice the stripped strings, as in
  jsdiff.
- **Report errors.** Wasm writes the message length and pointer to `[12:20)`.
  The driver writes `[1]` (0 = error) last, after all other stores. The host
  throws an `Error` with that message.

## Known limitations

- **Input size.** 256 MB per side, so text and offset sizes fit in i32. Tables
  sized by token count check for themselves: `$internInit` (above 2^27 tokens)
  and `$myers` (`bestPath`, about 2^28 tokens) report `out of memory` before
  their size would wrap. Those tables would need 4 GiB or more anyway.
- **Time and memory.** Same as jsdiff: worst-case time O((N+M)·D), memory O(D²).
  Two large, unrelated inputs are the slow case. Wasm memory stops at 4 GiB.
  Then the library reports `out of memory` and does not trap.
