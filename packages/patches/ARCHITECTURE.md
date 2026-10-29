# Architecture

`@pierre/patches` produces the same output as `diff@9.0.0`. WAT (WebAssembly
Text) contains all diff logic. The TypeScript host checks options, writes input,
and reads results.

```text
JS strings -> WTF-8 bytes -> tokens -> integer ids -> Myers diff
                                                    ├─ change records -> JS string slices
                                                    └─ unified patch -> decoded string
```

## Source files

| File                                     | Purpose                                                         |
| ---------------------------------------- | --------------------------------------------------------------- |
| [`src/mem.wat`](./src/mem.wat)           | Memory layout, allocation, byte operations, token hash          |
| [`src/tokenize.wat`](./src/tokenize.wat) | WTF-8 decoder, tokenizers, token ids                            |
| [`src/myers.wat`](./src/myers.wat)       | Myers algorithm, change components, change records              |
| [`src/patch.wat`](./src/patch.wat)       | Entry point, hunk groups, headers, patch output                 |
| [`lib/core.ts`](./lib/core.ts)           | Shared host code and public APIs                                |
| [`lib/index.ts`](./lib/index.ts)         | Node, Deno, Bun, and browser entry point with inline wasm bytes |
| [`lib/workerd.ts`](./lib/workerd.ts)     | Cloudflare Workers entry point with a native wasm import        |
| [`scripts/build.ts`](./scripts/build.ts) | WAT preprocessor, compiler, optimizer                           |
| [`test/`](./test/)                       | API, tokenizer, size-limit, and jsdiff fuzz tests               |
| [`benchmark/`](./benchmark/)             | Throughput and memory comparisons with jsdiff                   |

## Compatibility

The output must match jsdiff byte for byte, even for lone surrogates. Fuzz tests
compare every diff and patch API with `diff@9.0.0`. These rules affect the
result:

- **Tokens:** characters split like `Array.from`, words use jsdiff's
  `extendedWordChars` ranges, and lines split after each `\n`.

- **Line options:** `ignoreWhitespace` compares lines with `trim()` and keeps
  the new text for common lines. `stripTrailingCr` replaces `\r\n` with `\n`
  before the diff, so change values use the normalized text.

- **Myers paths:** the algorithm keeps jsdiff's tie-break, diagonal limits, and
  component merge rules. It computes `kEnd` each iteration and `kStart` once per
  edit length. The tie-break is
  `!canRemove || (canAdd && removePath.oldPos < addPath.oldPos)`.

- **Hunks:** context comes from the previous common component. Hunks merge when
  `lines.length <= context * 2 && i < diff.length - 2`. The output preserves
  jsdiff's final sentinel, no-newline markers, and start positions for empty
  sides.

The host rejects unsupported active options and callbacks. The
[README](./README.md#apis) lists the supported options and defaults.

## Tokens and the diff loop

Each token refers to one byte range in the input. A word or line of up to 3
bytes is its own id: its bytes and its length. A longer token gets its slot in a
hash table as its id. A byte comparison confirms each hash match. Each instance
hashes with a random multiplier, so crafted inputs cannot make many tokens share
a slot and slow the table down. With `ignoreWhitespace`, line ids use the range
after `trim()`, so equal ids can refer to different original bytes.

Characters use their code points as ids and need no hash table. Lone surrogates
keep their UTF-16 code units. Invalid UTF-8 bytes get ids above the Unicode
range.

The tokenizers and diff loop avoid repeated work:

- The character tokenizer reads 16 ASCII characters per step.
- The word tokenizer uses an ASCII class table and decodes non-ASCII characters.
  It has no branch at token ends: each character writes its offset, and only a
  token start keeps it.
- The line tokenizer finds each `\n` in one SIMD pass, 32 bytes per step.
- The Myers loop follows a common run four token ids per step. Its final read
  can extend 12 bytes into later allocations, but the match count stops at the
  array end.

The Myers algorithm stores each diagonal as an 8-byte `(oldPos, lastComponent)`
entry in `bestPath`. It initializes entries as needed, so setup costs O(D).
Here, D is the edit distance.

Paths share immutable nodes. Each step adds a 4-byte node for one added or
removed token, and an 8-byte node for a common run. A link to a node keeps the
node kind in its low 2 bits. `$buildComps` then joins adjacent added or removed
nodes of the final path, as jsdiff's `addToPath` does. This preserves jsdiff's
path behavior without JavaScript objects for each node.

The diagonal loop calls no functions, because V8 spills all live values around a
wasm call. Nodes come from a bump pointer, and each edit length reserves the
memory for its nodes first.

## Results

### Change records

`$emitRecords` writes one 16-byte record per change:

| Field          | Meaning                                                                |
| -------------- | ---------------------------------------------------------------------- |
| `flags`        | `0` common, `1` removed, `2` added                                     |
| `count`        | Token count                                                            |
| `start`, `end` | UTF-16 offsets in the old text for removals, or the new text otherwise |

Wasm converts byte offsets to UTF-16 offsets in one SIMD pass and skips ASCII
inputs. With `ignoreWhitespace`, each side counts its own UTF-16 units. The host
uses `String.slice` to read values, with no text copy in wasm and no decode.

### Unified patches

`$emitPatch` applies jsdiff's `structuredPatch` rules to the components. When a
hunk closes, it writes the hunk header, then a prefix and token bytes for each
line.

Wasm also writes the optional file headers and quotes filenames with Git-style C
escapes. It preserves line endings and adds `\ No newline at end of file` where
needed. A patch with no headers or hunks is `"\n"`, as in jsdiff.

The host decodes the complete patch once. `TextDecoder` uses `ignoreBOM: true`
to preserve U+FEFF at the start.

## Unicode at the host boundary

The host writes WTF-8 with a JS loop for texts shorter than 256 UTF-16 units: a
call to `TextEncoder.encodeInto` costs more than the loop for short texts. A
longer text uses `encodeInto`. If the result is not pure ASCII and
`isWellFormed()` is false, the JS loop writes the text again. The loop encodes
each lone surrogate as WTF-8, so different surrogates stay distinct from each
other and from U+FFFD, as in jsdiff.

For patch output with lone surrogates, the host decodes the bytes between them
and restores each original code unit. Change records need no decoder because
their offsets refer to JavaScript strings.

## Memory and limits

The first 64 KiB page holds control fields and static data. Input starts at byte
65536: old text, new text, then filenames and headers for patches. A 32-byte pad
allows SIMD reads past the input end. The workspace follows the pad.
[`src/mem.wat`](./src/mem.wat) contains the full layout and field offsets.

The bump allocator reserves token arrays, the hash table, Myers state, and
output in sequence. It grows memory with 25% extra space to reduce growth calls.
The next call resets the workspace after its input. Individual allocations need
no cleanup.

Wasm memory cannot shrink. After the host reads a result or a wasm error, it
replaces the instance if memory exceeds `setMemoryLimit` (default 32 MB). The
garbage collector can then free the old memory. This limit controls memory
between calls, not peak memory during a call. `Infinity` keeps all memory.

- Each input has a 256 MB limit. Token tables check their sizes before integer
  overflow.
- Worst-case time is `O((N+M)·D)`, and component memory is `O(D²)`, as in
  jsdiff. N and M are the token counts. Large, unrelated inputs are the
  expensive case.
- Wasm memory has a 4 GiB limit. If wasm cannot allocate memory, it returns
  `out of memory` without a trap. The host reads the message and throws an
  `Error`.

## Build

`moonx patches:build` runs [`scripts/build.ts`](./scripts/build.ts), then
tsdown:

1. `transformWat()` inlines local WAT imports and converts string constants to
   little-endian integers.
2. `wat2wasm()` compiles with wabt, with bulk memory and SIMD enabled.
3. `optimizeWasm()` runs three binaryen passes with `-O3 --shrink-level=1` and
   the optimized Stack IR writer. `--one-caller-inline-max-size=250` keeps
   `$myers` and `$emitPatch` out of the entry function, so V8 compiles the Myers
   loop alone.

The build writes `dist/patch.wat`, `dist/patch.wasm`, `dist/patch.wasm.mjs`, and
the compiled host code. It also records wasm sizes in `package.json` under
`meta`. Tests and benchmarks use the same build functions to compile WAT in
memory.
