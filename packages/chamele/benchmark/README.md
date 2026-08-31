# Chamele benchmarks

These benchmarks compare Chamele with Shiki and `tree-sitter-highlight` across
HTML generation, token output, HAST output, and streaming tokenization.

## Run

```sh
moon run chamele:bench
moon run chamele:bench-tokens
moon run chamele:bench-stream
```

- `bench` measures end-to-end HTML generation for CSS, HTML, JSONC, and
  TypeScript.
- `bench-tokens` compares the complete `codeToTokens` and `codeToHast` APIs on
  TypeScript.
- `bench-stream` creates fresh per-file state and processes 4,096-character
  chunks, matching Diffs' batching.

Fixtures live in [`fixtures`](./fixtures).

## HTML generation

| Input                      |        Chamele, bytes |           Chamele | tree-sitter-highlight |                Shiki |
| -------------------------- | --------------------: | ----------------: | --------------------: | -------------------: |
| `small.jsonc.txt` (30 KB)  | **3,476 MB/s (217×)** | 2,491 MB/s (155×) |     49.7 MB/s (3.10×) | 16.0 MB/s (baseline) |
| `tiny.jsonc.txt` (1 KB)    | **2,105 MB/s (134×)** | 1,604 MB/s (102×) |     51.8 MB/s (3.30×) | 15.7 MB/s (baseline) |
| `large.jsonc.txt` (292 KB) | **1,241 MB/s (220×)** | 1,061 MB/s (188×) |     23.8 MB/s (4.22×) | 5.64 MB/s (baseline) |
| `small.html.txt` (4 KB)    |   **594 MB/s (275×)** |  212 MB/s (98.5×) |     18.1 MB/s (8.39×) | 2.16 MB/s (baseline) |
| `tiny.html.txt` (2 KB)     |   **587 MB/s (452×)** |   367 MB/s (282×) |     19.9 MB/s (15.3×) | 1.30 MB/s (baseline) |
| `large.html.txt` (409 KB)  | **553 MB/s (1,703×)** |   235 MB/s (724×) |      35.2 MB/s (108×) | 0.32 MB/s (baseline) |
| `tiny.css.txt` (2 KB)      |   **448 MB/s (747×)** |   272 MB/s (453×) |     12.1 MB/s (20.1×) | 0.60 MB/s (baseline) |
| `large.ts.txt` (466 KB)    |   **383 MB/s (268×)** |   336 MB/s (235×) |     9.57 MB/s (6.70×) | 1.43 MB/s (baseline) |
| `tiny.ts.txt` (1 KB)       |   **374 MB/s (216×)** |   334 MB/s (193×) |     8.77 MB/s (5.07×) | 1.73 MB/s (baseline) |
| `large.css.txt` (304 KB)   |   **364 MB/s (370×)** |   183 MB/s (186×) |     8.90 MB/s (9.02×) | 0.99 MB/s (baseline) |
| `small.ts.txt` (31 KB)     |   **349 MB/s (387×)** |   298 MB/s (330×) |     8.05 MB/s (8.91×) | 0.90 MB/s (baseline) |
| `small.css.txt` (24 KB)    |   **328 MB/s (343×)** |   270 MB/s (282×) |     8.46 MB/s (8.86×) | 0.96 MB/s (baseline) |

> Run on 2026-08-31 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
> (macOS arm64). Rows are sorted by Chamele byte-API throughput.

Shiki is the baseline. `Chamele, bytes` receives pre-encoded UTF-8 and leaves
the result as bytes; regular Chamele includes input encoding and output
decoding. `tree-sitter-highlight` 1.1.2 escapes HTML input but emits no token
spans for it, so its HTML rows perform less highlighting work. Themes and markup
differ between tools, making this an end-to-end throughput comparison rather
than a byte-identical output comparison.

## Tokens and HAST

These suites compare Chamele's complete Shiki-compatible APIs against Shiki on
TypeScript. Chamele uses Pierre Dark; Shiki uses GitHub Dark. Neither uses
transformers or decorations.

### `codeToTokens`

| Input                       |  Lines | Chamele | Throughput |   Shiki | Speedup |
| --------------------------- | -----: | ------: | ---------: | ------: | ------: |
| `tiny.ts.txt` (1 KB)        |     50 | 7.79 µs |   168 MB/s |  680 µs |   87.2× |
| `small.ts.txt` (31 KB)      |    826 |  181 µs |   165 MB/s | 32.6 ms |    180× |
| `large.ts.txt` (466 KB)     | 10,673 | 2.67 ms |   170 MB/s |  304 ms |    114× |
| `unicode-lines.ts` (498 KB) | 10,001 | 2.59 ms |   199 MB/s |  473 ms |    183× |

### `codeToHast`

| Input                       |  Lines | Chamele | Throughput |   Shiki | Speedup |
| --------------------------- | -----: | ------: | ---------: | ------: | ------: |
| `tiny.ts.txt` (1 KB)        |     50 | 23.4 µs |  55.8 MB/s |  732 µs |   31.2× |
| `small.ts.txt` (31 KB)      |    826 |  488 µs |  61.2 MB/s | 34.3 ms |   70.2× |
| `large.ts.txt` (466 KB)     | 10,673 | 10.4 ms |  43.9 MB/s |  317 ms |   30.6× |
| `unicode-lines.ts` (498 KB) | 10,001 | 10.5 ms |  48.9 MB/s |  488 ms |   46.3× |

> Run on 2026-08-30 with Node.js 24.11.0 on a 14-core Apple M4 Pro with 48 GB
> RAM (macOS arm64). The Unicode fixture contains 10,000 generated lines and
> exercises byte-to-UTF-16 offset conversion.

## Streaming

| Input                       |  Lines | Chunks | Chamele | Throughput |    Shiki | Speedup |
| --------------------------- | -----: | -----: | ------: | ---------: | -------: | ------: |
| `tiny.css.txt` (2 KB)       |     85 |      1 | 9.83 µs |   152 MB/s |  2.42 ms |    246× |
| `tiny.html.txt` (2 KB)      |     51 |      1 | 11.6 µs |   158 MB/s |  1.19 ms |    103× |
| `tiny.jsonc.txt` (1 KB)     |     17 |      1 | 2.50 µs |   562 MB/s |  61.9 µs |   24.8× |
| `tiny.ts.txt` (1 KB)        |     50 |      1 | 7.42 µs |   176 MB/s |   629 µs |   84.8× |
| `small.css.txt` (24 KB)     |  1,388 |      6 |  175 µs |   131 MB/s |  21.3 ms |    121× |
| `small.html.txt` (4 KB)     |      2 |      1 | 21.1 µs |   178 MB/s |  1.45 ms |   68.6× |
| `small.jsonc.txt` (30 KB)   |    337 |      8 | 37.2 µs |   778 MB/s |  1.36 ms |   36.6× |
| `small.ts.txt` (31 KB)      |    826 |      8 |  176 µs |   170 MB/s |  32.8 ms |    186× |
| `large.css.txt` (304 KB)    | 17,619 |     77 | 2.22 ms |   134 MB/s |   278 ms |    125× |
| `large.html.txt` (409 KB)   |     46 |    103 | 2.49 ms |   161 MB/s | 1,268 ms |    510× |
| `large.jsonc.txt` (292 KB)  |  8,561 |     74 |  983 µs |   290 MB/s |  35.3 ms |   36.0× |
| `large.ts.txt` (466 KB)     | 10,673 |    117 | 2.48 ms |   184 MB/s |   298 ms |    120× |
| `unicode-lines.ts` (498 KB) | 10,001 |    105 | 3.09 ms |   167 MB/s |   426 ms |    138× |

> Run on 2026-08-31 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
> (macOS arm64).

Every sample creates a fresh Chamele `TokenizeStream`. Completed streams return
one reasonably sized Wasm instance to a single-slot pool; active streams remain
isolated. Shiki reuses its highlighter but starts with empty grammar state.
Chamele preserves lexer state between chunks; Shiki carries grammar state
between completed lines.

## Sampling

Each case performs a short warmup, then collects samples until 1.5 seconds
elapse or 2,000 iterations complete, with a minimum of three samples. Tables
report the median sample. Throughput divides each fixture's UTF-8 byte size by
that median time.

Benchmark results vary with the runtime, hardware, power state, and background
load. Compare tools within the same run rather than across tables measured under
different runtimes.
