# Highlights benchmarks

These benchmarks measure HTML output, themed tokens, input streams, document
edits, and memory use. HTML and token results compare Highlights with Shiki.
HTML results also include `tree-sitter-highlight`. Edit results compare an
incremental update with tokenization of the complete document.

All Highlights results use the combined Wasm module with all 190 lexers. The
`@pierre/highlights` entry loads this module at import. The benchmarks do not
measure `createHighlighter()` with selected language modules, which uses
separate lexer and emitter modules.

## Run

```sh
moon run highlights:bench
moon run highlights:bench-tokens
moon run highlights:bench-stream
moon run highlights:bench-live
moon run highlights:bench-memory
```

- `bench`: HTML generation for CSS, HTML, JSONC, and TypeScript.
- `bench-tokens`: complete `codeToTokens` output for TypeScript.
- `bench-stream`: tokenization in chunks of 4,096 UTF-16 code units.
- `bench-live`: initialization, edits, cached reads, and Wasm memory use.
- `bench-memory`: Bun memory usage for TypeScript against Shiki JS and Shiki
  Wasm.

Pass `-- --wide` to the first three tasks to show all table columns.

The [`fixtures`](./fixtures) directory contains the source files. The scripts
generate the Unicode and 100k-line inputs.

These results are from **2026-11-13**. The tests used Bun 1.4.0 on an Apple M4
Pro (14 cores, 48 GiB RAM, macOS 27.0.1 arm64). That Wasm build measured 394,507
bytes, or 185,025 bytes with gzip. Each table shows one complete run of its
mode.

## HTML generation

Throughput is input MiB per second. Values in parentheses compare the speed with
Shiki when both APIs use strings.

| Input                       | highlights (bytes) | highlights | tree-sitter (NAPI) | shiki |
| --------------------------- | -----------------: | ---------: | -----------------: | ----: |
| `tiny.css.txt` (2 KiB)      |                431 | 358 (593×) |       12.2 (20.3×) |  0.60 |
| `tiny.html.txt` (2 KiB)     |                477 | 390 (287×) |                  — |  1.36 |
| `tiny.jsonc.txt` (2 KiB)    |                780 | 613 (129×) |       18.9 (3.99×) |  4.74 |
| `tiny.ts.txt` (2 KiB)       |                439 | 390 (270×) |       10.1 (7.00×) |  1.44 |
| `small.css.txt` (24 KiB)    |                276 | 243 (245×) |       8.95 (9.03×) |  0.99 |
| `small.html.txt` (28 KiB)   |                621 | 552 (288×) |                  — |  1.91 |
| `small.jsonc.txt` (33 KiB)  |                709 | 632 (168×) |       14.8 (3.93×) |  3.76 |
| `small.ts.txt` (31 KiB)     |                316 | 287 (310×) |       8.19 (8.84×) |  0.93 |
| `large.css.txt` (379 KiB)   |                374 | 272 (227×) |       11.3 (9.37×) |  1.20 |
| `large.html.txt` (474 KiB)  |                936 | 700 (255×) |                  — |  2.75 |
| `large.jsonc.txt` (292 KiB) |               1018 | 818 (142×) |       25.0 (4.34×) |  5.77 |
| `large.ts.txt` (517 KiB)    |                329 | 293 (282×) |       8.86 (8.53×) |  1.04 |

The comparison uses Shiki 4.4.1 and `tree-sitter-highlight` 1.1.2. The
`highlights` column includes conversion from strings to UTF-8 and from HTML
bytes to strings. The `highlights (bytes)` column uses bytes for input and
output. Tree-sitter has incomplete HTML support, so it has no HTML results.

## Tokens

This table measures complete `codeToTokens` output for TypeScript. Highlights
uses Pierre Dark. Shiki uses GitHub Dark. The Unicode input has 10,000 content
lines and a final empty line. It includes non-ASCII text to exercise UTF-16
offsets.

| Input                        |  Lines | Highlights | Throughput |   Shiki | Speedup |
| ---------------------------- | -----: | ---------: | ---------: | ------: | ------: |
| `tiny.ts.txt` (2 KiB)        |     76 |    6.90 µs |  270 MiB/s | 1050 µs |    152× |
| `small.ts.txt` (31 KiB)      |    826 |     132 µs |  226 MiB/s | 29.2 ms |    221× |
| `large.ts.txt` (517 KiB)     | 10,826 |    2239 µs |  225 MiB/s |  434 ms |    194× |
| `unicode-lines.ts` (527 KiB) | 10,001 |    1872 µs |  275 MiB/s |  379 ms |    203× |

## Streaming

| Input                        |  Lines | Chunks | Highlights | Throughput |   Shiki | Speedup |
| ---------------------------- | -----: | -----: | ---------: | ---------: | ------: | ------: |
| `tiny.css.txt` (2 KiB)       |     85 |      1 |    8.83 µs |  169 MiB/s | 2350 µs |    266× |
| `tiny.html.txt` (2 KiB)      |     51 |      1 |    9.52 µs |  193 MiB/s | 1218 µs |    128× |
| `tiny.jsonc.txt` (2 KiB)     |     66 |      1 |    8.59 µs |  220 MiB/s |  238 µs |   27.7× |
| `tiny.ts.txt` (2 KiB)        |     76 |      1 |    9.71 µs |  192 MiB/s | 1145 µs |    118× |
| `small.css.txt` (24 KiB)     |  1,388 |      6 |     183 µs |  126 MiB/s | 20.0 ms |    109× |
| `small.html.txt` (28 KiB)    |    809 |      7 |     117 µs |  233 MiB/s | 11.7 ms |   99.8× |
| `small.jsonc.txt` (33 KiB)   |  1,105 |      9 |     144 µs |  226 MiB/s | 5533 µs |   38.5× |
| `small.ts.txt` (31 KiB)      |    826 |      8 |     165 µs |  182 MiB/s | 30.8 ms |    187× |
| `large.css.txt` (379 KiB)    | 17,455 |     95 |    2311 µs |  160 MiB/s |  268 ms |    116× |
| `large.html.txt` (474 KiB)   | 11,329 |    119 |    1557 µs |  297 MiB/s |  133 ms |   85.3× |
| `large.jsonc.txt` (292 KiB)  |  8,561 |     74 |     899 µs |  317 MiB/s | 30.7 ms |   34.2× |
| `large.ts.txt` (517 KiB)     | 10,826 |    130 |    2740 µs |  184 MiB/s |  471 ms |    172× |
| `unicode-lines.ts` (527 KiB) | 10,001 |    105 |    2326 µs |  221 MiB/s |  408 ms |    175× |

Each run starts with new stream state and processes chunks of 4,096 UTF-16 code
units. Highlights saves lexer state between calls. Shiki saves grammar state.
Both collect token arrays with offsets from the start of the document.

## Live editing

These cases measure initialization, one-character edits, line insertion and
deletion, and cached reads. Each edit updates stored token records. The rebuild
comparison creates themed tokens for the complete edited document.

The 100k-line input repeats `large.ts.txt` ten times (108,251 lines). The
template viewport covers the first 120 lines. The distant viewport covers the
last 120 lines.

Edit measurements exclude deferred work and undo. Viewport results measure only
the synchronous response. In those cases, **Changed lines** counts viewport
lines that the call returns synchronously. The distant viewport calls returned
zero viewport lines in this run. Those lines completed through deferred work.

| Fixture              | Scenario                    |  Median |     p95 | Rebuild median | Changed lines |
| -------------------- | --------------------------- | ------: | ------: | -------------: | ------------: |
| large.ts (10k lines) | eager init                  | 4520 µs | 4813 µs |              — |             — |
|                      | edit top                    | 0.50 µs | 0.67 µs |        2265 µs |             1 |
|                      | edit middle                 | 0.67 µs | 0.87 µs |        2193 µs |             1 |
|                      | edit end                    | 0.54 µs | 0.75 µs |        2235 µs |             2 |
|                      | insert line                 | 1.04 µs | 1.29 µs |        2257 µs |             3 |
|                      | delete line                 | 0.67 µs | 0.87 µs |        2285 µs |             1 |
|                      | template propagation        |  865 µs |  981 µs |         429 µs |        10,824 |
|                      | template + viewport         | 51.0 µs | 79.0 µs |         425 µs |           118 |
|                      | template + distant viewport | 1006 µs | 1015 µs |         425 µs |             0 |
|                      | raw reads ×100              | 3.17 µs | 3.88 µs |              — |             — |
|                      | themed reads ×100           | 18.0 µs | 26.9 µs |              — |             — |
| synthetic 100k lines | eager init                  | 35.2 ms | 37.4 ms |              — |             — |
|                      | edit top                    | 0.50 µs | 0.71 µs |        23.0 ms |             1 |
|                      | edit middle                 | 0.63 µs | 0.83 µs |        23.3 ms |             1 |
|                      | edit end                    | 0.58 µs | 0.83 µs |        23.1 ms |             2 |
|                      | insert line                 | 0.88 µs | 1.25 µs |        29.8 ms |             4 |
|                      | delete line                 | 0.50 µs | 0.67 µs |        23.9 ms |             2 |
|                      | template propagation        | 26.1 ms | 28.1 ms |        21.1 ms |       108,249 |
|                      | template + viewport         | 80.9 µs |  101 µs |        21.4 ms |           118 |
|                      | template + distant viewport | 1022 µs | 1026 µs |        21.1 ms |             0 |
|                      | raw reads ×100              | 3.21 µs | 3.92 µs |              — |             — |
|                      | themed reads ×100           | 18.4 µs | 26.9 µs |              — |             — |
| unicode 10k lines    | eager init                  | 3646 µs | 4690 µs |              — |             — |
|                      | edit top                    | 0.58 µs | 0.79 µs |        1920 µs |             1 |
|                      | edit middle                 | 0.71 µs | 0.92 µs |        1908 µs |             1 |
|                      | edit end                    | 0.67 µs | 0.88 µs |        1919 µs |             1 |
|                      | insert line                 | 0.75 µs | 0.96 µs |        1897 µs |             2 |
|                      | delete line                 | 0.54 µs | 0.71 µs |        1938 µs |             1 |
|                      | template propagation        |  619 µs |  672 µs |         729 µs |         9,999 |
|                      | template + viewport         | 50.5 µs | 77.0 µs |         736 µs |           118 |
|                      | template + distant viewport | 1006 µs | 1018 µs |         725 µs |             0 |
|                      | raw reads ×100              | 3.17 µs | 3.79 µs |              — |             — |
|                      | themed reads ×100           | 20.2 µs | 31.0 µs |              — |             — |

The next cases use repeated `const value = 1;` lines or one long line of
repeated `x+1;` expressions. Each local or top/end edit includes one raw record
read. Edits to a long line use a viewport of one line.

| Fixture               | Scenario                   |  Median |     p95 |
| --------------------- | -------------------------- | ------: | ------: |
| synthetic 100k lines  | local edit + read          | 0.57 µs | 0.60 µs |
| synthetic 100k lines  | alternating top/end + read | 0.59 µs | 0.62 µs |
| synthetic 1000k lines | local edit + read          | 0.54 µs | 0.57 µs |
| synthetic 1000k lines | alternating top/end + read | 0.59 µs | 0.63 µs |
| 1 MiB dense line      | edit + viewport            | 1299 µs | 1340 µs |
| 5 MiB dense line      | edit + viewport            | 2333 µs | 2396 µs |

The 100k-line document uses 17.4 MiB of Wasm memory. This includes 13.0 MiB of
live heap data and 643 distinct saved lexer states.

## Memory Usage

```sh
moon run highlights:bench-memory
moonx highlights:bench-memory -- --samples 5 --json /tmp/highlights-memory.json
```

The memory benchmark uses Bun with five new processes per workload and engine.
The inputs are `tiny.ts.txt`, `small.ts.txt`, `large.ts.txt`, and `large.ts.txt`
repeated ten times (5,289,410 bytes, 108,251 lines). Each input produces HTML
and themed tokens in separate processes.

Use `--samples 1` for a quick check.

The comparison uses **Shiki 4.4.1**. Values show the median **peak process RSS
in MiB** from five new processes per workload and engine. The benchmark uses
**120 processes** in total. RSS is the physical memory that a process uses.

| Workload         | Highlights | Shiki JS | Shiki Wasm |
| ---------------- | ---------: | -------: | ---------: |
| 2 KiB → HTML     |     **39** |       78 |        146 |
| 2 KiB → tokens   |     **40** |       77 |        148 |
| 31 KiB → HTML    |     **42** |       92 |        181 |
| 31 KiB → tokens  |     **45** |       91 |        173 |
| 517 KiB → HTML   |     **54** |      157 |        347 |
| 517 KiB → tokens |     **58** |      114 |        309 |
| 5 MiB → HTML     |    **106** |      737 |        959 |
| 5 MiB → tokens   |    **134** |      327 |        488 |

The table shows peak RSS through the first complete call, rounded to whole MiB.
RSS includes the runtime, compiled code, Wasm, and allocator capacity. Both HTML
APIs return complete strings. The Highlights measurement includes UTF-8 decode
time.

Both libraries use GitHub Dark. Shiki's line-length and time limits are
disabled. Token boundaries and styles can differ between the libraries.

Samples run in sequence, with a different engine first in each round. The script
compiles and bundles code outside the measured processes. It deletes the
temporary build afterward. The benchmark does not need a Highlights build.
Highlights loads all 190 built-in lexers. Shiki loads only TypeScript.

`--json` saves each sample. It records RSS at startup, at the first-call peak,
and while the result remains in memory. It also records heap and external
counters, Wasm capacity, and input and output sizes.

The script measures retained results and checks output after the first-call
peak. RSS does not count live objects. The Wasm buffer does not shrink during
the lifetime of a highlighter.

## Sampling

The throughput and edit scripts use [`measure.ts`](./measure.ts). Each case has
a 200 ms warmup, a 1.5-second measurement budget, and at least 20 samples. The
order of the engines changes each round. Shiki's line-length and time limits are
disabled.

Throughput uses the median of per-call averages from batches of approximately 5
ms. The units are MiB per second. Repeated local and top/end edits also use
batch averages. Other edit cases measure individual calls.

Edit tables show the median and p95. The p95 value is the time at or below which
95% of measurements fall. Cleanup counts toward the budget but not the measured
call time.
