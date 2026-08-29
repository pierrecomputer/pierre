# Benchmark

Throughput and installed size for Chamele, tree-sitter-highlight, Lezer and
Shiki, plus a focused `codeToTokens` comparison and phase breakdown.

```sh
moonx chamele:bench
moonx chamele:bench-tokens
```

## Results

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

## `codeToTokens`

| Input                       |  Lines | Chamele | Throughput |   Shiki | Speedup |
| --------------------------- | -----: | ------: | ---------: | ------: | ------: |
| `tiny.ts.txt` (1 KB)        |     50 | 9.29 µs |   141 MB/s |  708 µs |   76.2× |
| `small.ts.txt` (31 KB)      |    826 |  225 µs |   133 MB/s | 34.6 ms |    154× |
| `large.ts.txt` (466 KB)     | 10,673 | 3.22 ms |   142 MB/s |  317 ms |   98.5× |
| `unicode-lines.ts` (498 KB) | 10,001 | 4.04 ms |   128 MB/s |  495 ms |    123× |

Chamele lexes and emits token runs in Wasm. In JavaScript, `splitRecordLines`
converts UTF-8 record ends to UTF-16 indexes, splits at `\n`, removes `\r` from
CRLF endings, and groups runs by line. ASCII uses direct byte-to-character
offsets. A final pass slices token content and builds themed token objects.

| Input              | UTF-8 encode | Wasm scan | JS line split | JS tokens | End-to-end | Split / E2E |
| ------------------ | -----------: | --------: | ------------: | --------: | ---------: | ----------: |
| `tiny.ts.txt`      |      0.54 µs |   3.00 µs |       2.25 µs |   2.88 µs |    9.29 µs |       24.4% |
| `small.ts.txt`     |      10.5 µs |   75.8 µs |       59.0 µs |   71.3 µs |     225 µs |       26.6% |
| `large.ts.txt`     |       154 µs |   1.05 ms |        850 µs |   1.03 ms |    3.22 ms |       26.4% |
| `unicode-lines.ts` |       428 µs |    849 µs |       1.71 ms |    999 µs |    4.04 ms |       42.5% |

> Measured on 2026-08-29 with Node.js 24.11.0 on a 14-core Apple M4 Pro with 48
> GB RAM (macOS arm64). Values are the median across three full benchmark runs.
> The phase timings are independent: the Wasm scan uses input already resident
> in linear memory, while the split and token passes use precomputed input. The
> Unicode case is 10,000 generated lines and exercises byte-to-UTF-16 offset
> conversion.

## Installed size

| tool                            |     size | contents                                        |
| ------------------------------- | -------: | ----------------------------------------------- |
| Chamele                         |  81.4 KB | 66.2 KB Wasm (27.4 KB gzip) and 15.2 KB JS glue |
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
using Pierre Dark for Chamele and GitHub Dark for Shiki.
