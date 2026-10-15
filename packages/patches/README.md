# @pierre/patches

A fast text diff library, written by hand in WAT (WebAssembly Text). It is a
drop-in replacement for the core APIs of
[jsdiff](https://github.com/kpdecker/jsdiff).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./benchmark/benchmark-dark.svg">
  <img alt="benchmark" src="./benchmark/benchmark-light.svg">
</picture>

See the [benchmark](./benchmark/README.md) page for the full results and the
method.

## Usage

```bash
npm i @pierre/patches
```

It works in Node.js, browsers, and Cloudflare Workers.

```js
import {
  createPatch,
  createTwoFilesPatch,
  diffChars,
  diffLines,
  diffWordsWithSpace,
} from '@pierre/patches';

diffChars('abcabba', 'cbabac');
// [{ count: 2, added: false, removed: true, value: "ab" }, ...]

diffWordsWithSpace('the quick fox', 'the slow fox');
// [{ count: 2, added: false, removed: false, value: "the " }, ...]

diffLines('line1\nline2\n', 'line1\nlineX\n');
// [{ count: 1, added: false, removed: false, value: "line1\n" }, ...]

console.log(
  createTwoFilesPatch('a.txt', 'b.txt', 'line1\nline2\n', 'line1\nlineX\n')
);
// ===================================================================
// --- a.txt
// +++ b.txt
// @@ -1,2 +1,2 @@
//  line1
// -line2
// +lineX
```

## APIs

- `diffChars(oldStr, newStr)`: one token is one Unicode code point.
- `diffWordsWithSpace(oldStr, newStr)`: one token is one word, one run of
  spaces, one newline, or one other character.
- `diffLines(oldStr, newStr, options?)`: one token is one line, with its `\n` or
  `\r\n`.
- `createTwoFilesPatch(oldFileName, newFileName, oldStr, newStr, oldHeader?, newHeader?, options?)`:
  returns a unified diff.
- `createPatch(fileName, oldStr, newStr, oldHeader?, newHeader?, options?)`:
  same as `createTwoFilesPatch(fileName, fileName, ...)`.
- `setMemoryLimit(bytes)`: how much wasm memory stays allocated between calls
  (default 32 MB). Wasm memory cannot shrink, so after a call that grows it past
  the limit, a new wasm instance replaces it. `Infinity` keeps all memory.

`diffLines` and the patch functions accept these jsdiff options:

- `ignoreWhitespace` (default `false`): compare lines without their leading and
  trailing whitespace. A common line keeps the new text.
- `stripTrailingCr` (default `false`): remove the `\r` of each `\r\n` before the
  diff.

The patch functions also accept:

- `context` (default `4`): unchanged lines around each change. A non-negative
  integer, or `Infinity` for the whole file.
- `headerOptions` (default: all lines on): `includeIndex`, `includeUnderline`,
  and `includeFileHeaders`. As in jsdiff, a field left out is off.

## Why it is fast

All the work happens in wasm linear memory. JavaScript only writes the input and
reads the result.

- **Interned tokens**: each different token gets a small integer id, so the
  Myers O(ND) loop compares ids, not text.
- **SIMD compare**: the inner loop compares 4 ids in one step.
- **Zero-copy values**: each change value is a slice of the input. Wasm returns
  only offsets, so no text is decoded.
- **Hand-written WAT**: no compiler sits between the code and the wasm. Each
  instruction in the hot path is there on purpose.

## Development

```bash
moonx patches:build                # preprocess the WAT, compile it with wabt and binaryen, then bundle the glue
moonx patches:test                 # run the tests (they compile the WAT in memory, no build needed)
moonx patches:bench                # compare throughput with diff@9.0.0
moonx patches:bench -- --chart     # also update benchmark-{light,dark}.svg
moonx patches:bench -- --memory    # also measure the memory that one call allocates
```

[ARCHITECTURE.md](./ARCHITECTURE.md) explains how the library works inside.

## License

Apache-2.0
