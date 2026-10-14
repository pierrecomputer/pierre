# @pierre/patch

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
npm i @pierre/patch
```

It works in Node.js, browsers, and Cloudflare Workers.

```js
import {
  createPatch,
  createTwoFilesPatch,
  diffChars,
  diffLines,
  diffWordsWithSpace,
} from '@pierre/patch';

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

## jsdiff compatibility

The output is the same as `diff@9.0.0`, byte for byte, lone surrogates included.
Fuzz tests check every API against jsdiff. The differences:

- Other options that change the result (`ignoreCase`, `newlineIsToken`,
  `ignoreNewlineAtEof`, `oneChangePerToken`, `maxEditLength`, `timeout`,
  callbacks) throw an error. An option set to `undefined`, `null`, or `false` is
  off, so it is accepted.
- A negative or non-integer `context` throws an error. jsdiff prints odd hunk
  headers, such as `@@ -2,3.5 +2,3.5 @@`.
- Each side is limited to 256 MB. Larger input fails with `out of memory`.

## Development

```bash
moonx patch:build                # preprocess the WAT, compile it with wabt and binaryen, then bundle the glue
moonx patch:test                 # run the tests (they compile the WAT in memory, no build needed)
moonx patch:bench                # compare throughput with diff@9.0.0
moonx patch:bench -- --chart     # also update benchmark-{light,dark}.svg
moonx patch:bench -- --memory    # also measure the memory that one call allocates
```

[ARCHITECTURE.md](./ARCHITECTURE.md) explains how the library works inside.

## License

Apache-2.0
