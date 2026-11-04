# Third-party notices

`@pierre/words` is licensed under Apache 2.0. The material below keeps its
original license.

## Data in the published package

| Data                            | Location                           | Source                                                                         | License                                                   |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| HTML named character references | `src/entities.txt`, `dist/md.wasm` | [WHATWG HTML `entities.json`](https://html.spec.whatwg.org/entities.json)      | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| East Asian Width ranges         | `scripts/build.ts`, `dist/md.wasm` | [Unicode `EastAsianWidth.txt`](https://www.unicode.org/Public/UCD/latest/ucd/) | [Unicode License v3](https://www.unicode.org/license.txt) |

## Test and benchmark files, not published

| File                             | Source                                                                                                                          | License                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `test/spec/commonmark-spec.json` | [CommonMark Spec 0.31.2](https://spec.commonmark.org/0.31.2/) by John MacFarlane                                                | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `test/spec/gfm-spec.json`        | [GitHub Flavored Markdown Spec 0.29](https://github.com/github/cmark-gfm/blob/0.29.0.gfm.13/test/spec.txt), based on CommonMark | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `benchmark/fixtures/gfm-spec.md` | The same GitHub Flavored Markdown Spec, without its front matter                                                                | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `benchmark/fixtures/simd.md`     | [WebAssembly SIMD proposal](https://github.com/WebAssembly/simd/blob/master/proposals/simd/SIMD.md)                             | See below                                                       |

The
[WebAssembly SIMD repository notice](https://github.com/WebAssembly/simd/blob/master/LICENSE)
lists a license for each of its top-level directories, and it does not list
`proposals/`. `simd.md` is used only as benchmark input.
