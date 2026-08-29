# Benchmark

Throughput and installed size for Chamele, tree-sitter-highlight, Lezer and
Shiki, plus focused `codeToTokens` and `codeToHast` comparisons.

```sh
moonx chamele:bench
moonx chamele:bench-tokens
```

## Results(`codeToHtml`)

| Input                      |        Chamele, bytes |           Chamele | tree-sitter-highlight |                Shiki |
| -------------------------- | --------------------: | ----------------: | --------------------: | -------------------: |
| `small.jsonc.txt` (30 KB)  | **2,044 MB/s (158×)** | 48.5 MB/s (3.77×) |     39.3 MB/s (3.06×) | 12.8 MB/s (baseline) |
| `tiny.jsonc.txt` (1 KB)    | **1,772 MB/s (138×)** | 50.4 MB/s (3.87×) |     16.3 MB/s (1.26×) | 13.1 MB/s (baseline) |
| `large.jsonc.txt` (292 KB) |   **692 MB/s (140×)** | 22.8 MB/s (4.58×) |     14.3 MB/s (2.93×) | 4.97 MB/s (baseline) |
| `small.html.txt` (4 KB)    |   **387 MB/s (178×)** | 17.4 MB/s (8.08×) |     13.1 MB/s (6.08×) | 2.15 MB/s (baseline) |
| `large.html.txt` (409 KB)  | **368 MB/s (1,168×)** |  32.1 MB/s (101×) |     30.9 MB/s (98.2×) | 0.32 MB/s (baseline) |
| `tiny.css.txt` (2 KB)      |   **320 MB/s (614×)** | 12.0 MB/s (22.6×) |     10.8 MB/s (20.4×) | 0.52 MB/s (baseline) |
| `tiny.html.txt` (2 KB)     |   **317 MB/s (248×)** | 20.1 MB/s (16.0×) |     18.6 MB/s (14.9×) | 1.25 MB/s (baseline) |
| `large.ts.txt` (466 KB)    |   **293 MB/s (254×)** | 9.24 MB/s (8.08×) |     7.43 MB/s (6.46×) | 1.15 MB/s (baseline) |
| `tiny.ts.txt` (1 KB)       |   **285 MB/s (199×)** | 8.58 MB/s (5.97×) |     7.09 MB/s (4.96×) | 1.44 MB/s (baseline) |
| `large.css.txt` (304 KB)   |   **270 MB/s (332×)** | 8.74 MB/s (10.8×) |     5.27 MB/s (6.46×) | 0.81 MB/s (baseline) |
| `small.ts.txt` (31 KB)     |   **253 MB/s (353×)** | 7.40 MB/s (10.4×) |     5.27 MB/s (7.36×) | 0.72 MB/s (baseline) |
| `small.css.txt` (24 KB)    |   **244 MB/s (289×)** | 8.42 MB/s (10.0×) |     4.53 MB/s (5.52×) | 0.82 MB/s (baseline) |

> Measured on 2026-08-24 with Node.js 24.19.0 on a 14-core Apple M4 Pro with 48
> GB RAM (macOS arm64). Higher is better. Parentheses show speedup over Shiki.
> Rows are sorted by Chamele byte-API throughput.

## Results(`codeToTokens`)

| Input                       |  Lines | JS split | Wasm split | Change | Throughput |   Shiki | Speedup |
| --------------------------- | -----: | -------: | ---------: | -----: | ---------: | ------: | ------: |
| `tiny.ts.txt` (1 KB)        |     50 |  9.29 µs |    8.08 µs |  1.15× |   162 MB/s |  709 µs |   87.7× |
| `small.ts.txt` (31 KB)      |    826 |   224 µs |     196 µs |  1.14× |   153 MB/s | 34.1 ms |    174× |
| `large.ts.txt` (466 KB)     | 10,673 |  3.21 ms |    2.87 ms |  1.12× |   158 MB/s |  316 ms |    110× |
| `unicode-lines.ts` (498 KB) | 10,001 |  4.10 ms |    2.77 ms |  1.48× |   186 MB/s |  490 ms |    177× |

Mode 2, the previous path, emits UTF-8 byte-end records. JavaScript then
converts offsets to UTF-16, finds line endings, removes CR from CRLF, creates
per-line run tuples, and finally builds themed token objects.

`codeToTokens` now uses mode 3. The lexer first emits the same ordered byte-end
records. A Wasm post-pass scans the covered input once and produces UTF-16
record ends with newline markers. JavaScript builds themed tokens directly from
those records, avoiding the host split and its intermediate arrays. The extra
mode adds 467 bytes to optimized Wasm (234 bytes gzip), about 0.7% and 0.8%.

| Input              | UTF-8 encode | Byte Wasm | JS split | JS tokens | Line Wasm | Direct tokens |  JS E2E | Wasm E2E |
| ------------------ | -----------: | --------: | -------: | --------: | --------: | ------------: | ------: | -------: |
| `tiny.ts.txt`      |      0.54 µs |   2.96 µs |  2.25 µs |   2.92 µs |   4.50 µs |       2.75 µs | 9.29 µs |  8.08 µs |
| `small.ts.txt`     |      10.2 µs |   76.7 µs |  59.0 µs |   71.6 µs |    112 µs |       69.2 µs |  224 µs |   196 µs |
| `large.ts.txt`     |       156 µs |   1.06 ms |   845 µs |   1.01 ms |   1.68 ms |        942 µs | 3.21 ms |  2.87 ms |
| `unicode-lines.ts` |       433 µs |    858 µs |  1.74 ms |   1.02 ms |   1.35 ms |        961 µs | 4.10 ms |  2.77 ms |

> Measured on 2026-08-29 with Node.js 24.11.0 on a 14-core Apple M4 Pro with 48
> GB RAM (macOS arm64). Values are the median across three full benchmark runs.
> The phase timings are independent: both Wasm scans use input already resident
> in linear memory, while the split and token passes use precomputed input. The
> Unicode case is 10,000 generated lines and exercises byte-to-UTF-16 offset
> conversion.

## Results(`codeToHast`)

| Input                       |  Lines | JS split | Wasm split | Change | Throughput |
| --------------------------- | -----: | -------: | ---------: | -----: | ---------: |
| `tiny.ts.txt` (1 KB)        |     50 |  24.7 µs |    23.8 µs |  1.04× |  55.0 MB/s |
| `small.ts.txt` (31 KB)      |    826 |   526 µs |     515 µs |  1.02× |  58.1 MB/s |
| `large.ts.txt` (466 KB)     | 10,673 |  11.1 ms |    11.1 ms |  1.00× |  41.1 MB/s |
| `unicode-lines.ts` (498 KB) | 10,001 |  12.1 ms |    11.3 ms |  1.07× |  45.7 MB/s |

`codeToHast` also uses mode 3. JavaScript converts the line records into the
offset runs needed by decorations, then builds HAST and runs transformers. HAST
allocation dominates large ASCII input, where moving the split is neutral. The
change reuses the existing Wasm mode and adds no Wasm bytes.

| Input              | Host prep | Record glue | HAST build |  JS E2E | Wasm E2E |
| ------------------ | --------: | ----------: | ---------: | ------: | -------: |
| `tiny.ts.txt`      |   2.79 µs |     1.04 µs |    15.8 µs | 24.7 µs |  23.8 µs |
| `small.ts.txt`     |   70.2 µs |     23.8 µs |     353 µs |  526 µs |   515 µs |
| `large.ts.txt`     |   1.02 ms |      306 µs |    8.75 ms | 11.1 ms |  11.1 ms |
| `unicode-lines.ts` |   1.86 ms |      293 µs |    8.96 ms | 12.1 ms |  11.3 ms |

> Measured with the token results above. Host prep includes UTF-8-to-UTF-16
> conversion, newline splitting, and line-start discovery. Record glue only
> groups Wasm's UTF-16 records into the runs required by HAST.

## Installed size

| tool                            |     size | contents                                        |
| ------------------------------- | -------: | ----------------------------------------------- |
| Chamele                         |  81.9 KB | 66.8 KB Wasm (27.7 KB gzip) and 15.2 KB JS glue |
| Shiki                           |   589 KB | TextMate grammars, themes, and engines          |
| Lezer (TS, JSON, CSS, and HTML) | 1,018 KB | LR parser tables as JS                          |
| tree-sitter-highlight           |  8.24 MB | darwin-arm64 native addon and index.js          |

## Method

Each case warms up, then runs for up to 1.5 seconds or 2,000 iterations. Results
are the median of three per-run median times. Fixtures are in
[`fixtures`](./fixtures).

All contenders include HTML generation. `tree-sitter-highlight` 1.1.2 escapes
HTML input but emits no token spans for it, so its HTML rows do less
highlighting work. `Chamele, bytes` receives encoded bytes; regular Chamele
includes string encoding and UTF-8 output decoding. Themes and markup vary. The
`codeToTokens` comparison instead includes each tool's complete token-array API,
using Pierre Dark for Chamele and GitHub Dark for Shiki. The `codeToHast`
comparison measures Chamele's complete HAST API without transformers or
decorations.
