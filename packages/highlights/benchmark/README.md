# Highlights benchmarks

These benchmarks compare Highlights with Shiki and `tree-sitter-highlight`
across HTML generation, tokens, HAST, streaming, and live editing.

## Run

```sh
moon run highlights:bench
moon run highlights:bench-tokens
moon run highlights:bench-stream
moon run highlights:bench-live
```

- `bench`: HTML generation for CSS, HTML, JSONC, and TypeScript.
- `bench-tokens`: complete `codeToTokens` and `codeToHast` APIs on TypeScript.
- `bench-stream`: streaming tokenization in 4,096-character chunks.
- `bench-live`: initialization, edits, cached reads, and retained Wasm memory.

Fixtures live in [`fixtures`](./fixtures).

## HTML generation

Throughput in MiB/s; parentheses show speedups over Shiki for string I/O.

| Input                       | highlights (bytes) |  highlights | tree-sitter (NAPI) | shiki |
| --------------------------- | -----------------: | ----------: | -----------------: | ----: |
| `tiny.css.txt` (2 KiB)      |                444 |  360 (563×) |       12.0 (18.8×) |  0.64 |
| `tiny.html.txt` (2 KiB)     |                629 |  497 (357×) |                  — |  1.39 |
| `tiny.jsonc.txt` (2 KiB)    |               1000 |  721 (150×) |       17.8 (3.72×) |  4.79 |
| `tiny.ts.txt` (2 KiB)       |                491 |  427 (281×) |       9.72 (6.39×) |  1.52 |
| `small.css.txt` (24 KiB)    |                307 |  282 (279×) |       8.86 (8.76×) |  1.01 |
| `small.html.txt` (28 KiB)   |               1253 | 1096 (566×) |                  — |  1.93 |
| `small.jsonc.txt` (33 KiB)  |                869 |  761 (195×) |       14.1 (3.63×) |  3.90 |
| `small.ts.txt` (31 KiB)     |                363 |  329 (349×) |       7.98 (8.46×) |  0.94 |
| `large.css.txt` (379 KiB)   |                415 |  202 (164×) |       10.8 (8.79×) |  1.23 |
| `large.html.txt` (474 KiB)  |               1422 |  351 (124×) |                  — |  2.84 |
| `large.jsonc.txt` (292 KiB) |               1179 |  999 (166×) |       24.4 (4.06×) |  6.00 |
| `large.ts.txt` (517 KiB)    |                395 |  356 (333×) |       8.53 (7.97×) |  1.07 |

> Recorded on 2026-09-06 with Bun 1.4.0 on an Apple M4 Pro (14 cores, 48 GB RAM,
> macOS arm64), using the optimized Wasm build.

Shiki 4.4.1 is the string-API baseline; Tree-sitter uses `tree-sitter-highlight`
1.1.2. Highlights includes UTF-8 encoding and HTML decoding;
`highlights (bytes)` accepts and returns bytes. Tree-sitter's HTML support is
incomplete, so those entries are omitted.

## Tokens and HAST

Complete token and HAST output on TypeScript, using Pierre Dark for Highlights
and GitHub Dark for Shiki. The Unicode fixture has 10,000 lines and exercises
UTF-16 offset conversion.

### `codeToTokens`

| Input                        |  Lines | Highlights | Throughput |   Shiki | Speedup |
| ---------------------------- | -----: | ---------: | ---------: | ------: | ------: |
| `tiny.ts.txt` (2 KiB)        |     76 |    7.86 µs |  237 MiB/s | 1007 µs |    128× |
| `small.ts.txt` (31 KiB)      |    826 |     151 µs |  199 MiB/s | 28.0 ms |    186× |
| `large.ts.txt` (517 KiB)     | 10,826 |    2370 µs |  213 MiB/s |  424 ms |    179× |
| `unicode-lines.ts` (527 KiB) | 10,001 |    2564 µs |  201 MiB/s |  376 ms |    147× |

### `codeToHast`

| Input                        |  Lines | Highlights | Throughput |   Shiki | Speedup |
| ---------------------------- | -----: | ---------: | ---------: | ------: | ------: |
| `tiny.ts.txt` (2 KiB)        |     76 |    24.1 µs | 77.4 MiB/s | 1035 µs |   43.0× |
| `small.ts.txt` (31 KiB)      |    826 |     426 µs | 70.3 MiB/s | 28.1 ms |   65.9× |
| `large.ts.txt` (517 KiB)     | 10,826 |    6641 µs | 76.0 MiB/s |  433 ms |   65.3× |
| `unicode-lines.ts` (527 KiB) | 10,001 |    5652 µs | 91.1 MiB/s |  384 ms |   68.0× |

## Streaming

| Input                        |  Lines | Chunks | Highlights | Throughput |   Shiki | Speedup |
| ---------------------------- | -----: | -----: | ---------: | ---------: | ------: | ------: |
| `tiny.css.txt` (2 KiB)       |     85 |      1 |    9.37 µs |  159 MiB/s | 2159 µs |    230× |
| `tiny.html.txt` (2 KiB)      |     51 |      1 |    8.40 µs |  218 MiB/s | 1068 µs |    127× |
| `tiny.jsonc.txt` (2 KiB)     |     66 |      1 |    8.08 µs |  234 MiB/s |  220 µs |   27.3× |
| `tiny.ts.txt` (2 KiB)        |     76 |      1 |    9.32 µs |  200 MiB/s | 1045 µs |    112× |
| `small.css.txt` (24 KiB)     |  1,388 |      6 |     207 µs |  111 MiB/s | 18.1 ms |   87.9× |
| `small.html.txt` (28 KiB)    |    809 |      7 |    93.3 µs |  293 MiB/s | 10.7 ms |    114× |
| `small.jsonc.txt` (33 KiB)   |  1,105 |      9 |     169 µs |  192 MiB/s | 5067 µs |   30.0× |
| `small.ts.txt` (31 KiB)      |    826 |      8 |     186 µs |  161 MiB/s | 28.7 ms |    155× |
| `large.css.txt` (379 KiB)    | 17,455 |     95 |    2628 µs |  141 MiB/s |  247 ms |   93.9× |
| `large.html.txt` (474 KiB)   | 11,329 |    119 |    1820 µs |  254 MiB/s |  124 ms |   68.1× |
| `large.jsonc.txt` (292 KiB)  |  8,561 |     74 |    1063 µs |  268 MiB/s | 28.2 ms |   26.5× |
| `large.ts.txt` (517 KiB)     | 10,826 |    130 |    2933 µs |  172 MiB/s |  442 ms |    151× |
| `unicode-lines.ts` (527 KiB) | 10,001 |    105 |    3018 µs |  171 MiB/s |  388 ms |    129× |

Each run starts with fresh stream state and processes 4,096-character chunks.
Highlights preserves lexer state; Shiki carries grammar state between calls.
Both collect token arrays with document-relative offsets.

## Live editing

Measures initialization, one-character edits, line insertion and deletion, and
cached reads. Edits update retained records; each rebuild materializes themed
tokens for the same edited text. The viewport covers 120 lines; flush and undo
happen outside the measured latency.

| Fixture              | Scenario             |  Median |     p95 | Rebuild median | Changed lines |
| -------------------- | -------------------- | ------: | ------: | -------------: | ------------: |
| large.ts (10k lines) | eager init           | 4321 µs | 4589 µs |              — |             — |
|                      | edit top             | 0.58 µs | 0.79 µs |        2373 µs |             1 |
|                      | edit middle          | 0.79 µs | 1.04 µs |        2369 µs |             1 |
|                      | edit end             | 0.67 µs | 0.87 µs |        2368 µs |             2 |
|                      | insert line          | 1.21 µs | 1.50 µs |        2383 µs |             3 |
|                      | delete line          | 0.71 µs | 0.92 µs |        2378 µs |             1 |
|                      | template propagation | 1173 µs | 1226 µs |         491 µs |        10,824 |
|                      | template + viewport  | 30.7 µs | 50.0 µs |         491 µs |           118 |
|                      | raw reads ×100       | 3.25 µs | 3.87 µs |              — |             — |
|                      | themed reads ×100    | 20.0 µs | 28.6 µs |              — |             — |
| synthetic 100k lines | eager init           | 35.7 ms | 36.0 ms |              — |             — |
|                      | edit top             | 0.63 µs | 0.87 µs |        24.7 ms |             1 |
|                      | edit middle          | 0.75 µs | 1.00 µs |        24.4 ms |             1 |
|                      | edit end             | 0.67 µs | 0.92 µs |        24.4 ms |             2 |
|                      | insert line          | 1.04 µs | 1.29 µs |        24.5 ms |             4 |
|                      | delete line          | 0.58 µs | 0.83 µs |        24.5 ms |             2 |
|                      | template propagation | 27.4 ms | 28.0 ms |        22.6 ms |       108,249 |
|                      | template + viewport  | 70.1 µs |  485 µs |        22.7 ms |           118 |
|                      | raw reads ×100       | 3.71 µs | 4.42 µs |              — |             — |
|                      | themed reads ×100    | 19.6 µs | 27.5 µs |              — |             — |
| unicode 10k lines    | eager init           | 4350 µs | 4736 µs |              — |             — |
|                      | edit top             | 0.79 µs | 1.00 µs |        2553 µs |             1 |
|                      | edit middle          | 0.87 µs | 1.12 µs |        2559 µs |             1 |
|                      | edit end             | 0.87 µs | 1.12 µs |        2570 µs |             1 |
|                      | insert line          | 0.87 µs | 1.08 µs |        2522 µs |             2 |
|                      | delete line          | 0.63 µs | 0.83 µs |        2531 µs |             1 |
|                      | template propagation | 1487 µs | 1538 µs |        1633 µs |         9,999 |
|                      | template + viewport  | 36.7 µs | 50.5 µs |        1643 µs |           118 |
|                      | raw reads ×100       | 3.21 µs | 3.83 µs |              — |             — |
|                      | themed reads ×100    | 21.2 µs | 31.0 µs |              — |             — |

The 100k-line document retains 16.8 MiB of Wasm memory, with 12.6 MiB of live
heap and 133 interned lexer states.

## Sampling

Both scripts use [`measure.ts`](./measure.ts): a 200 ms warmup, a 1.5-second
budget per case, at least 20 samples, and rotating contender order. Benchmark
modes run sequentially; Shiki's line-length and time limits are disabled.

Throughput uses the median of per-call batch averages (~5 ms batches), in MiB/s.
Live editing measures individual calls and reports median and p95. Cleanup
counts toward the budget but is excluded from latency.
