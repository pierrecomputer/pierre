# Highlights benchmarks

These benchmarks measure HTML output, themed tokens, input streams, document
edits, and memory use. HTML and token results compare Highlights with Shiki.
HTML results also include `tree-sitter-highlight`. Edit results compare an
incremental update with tokenization of the complete document.

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

These results are from **2026-10-05**. The tests used Bun 1.4.0 on an Apple M4
Pro (14 cores, 48 GiB RAM, macOS 27.0.1 arm64). That Wasm build measured 170,853
bytes, or 77,955 bytes with gzip. Each table shows one complete run of its mode.
The five modes ran in sequence.

## HTML generation

Throughput is input MiB per second. Values in parentheses compare the speed with
Shiki when both APIs use strings.

| Input                       | highlights (bytes) | highlights | tree-sitter (NAPI) | shiki |
| --------------------------- | -----------------: | ---------: | -----------------: | ----: |
| `tiny.css.txt` (2 KiB)      |                466 | 375 (638×) |       11.9 (20.2×) |  0.59 |
| `tiny.html.txt` (2 KiB)     |                536 | 434 (312×) |                  — |  1.39 |
| `tiny.jsonc.txt` (2 KiB)    |                798 | 614 (130×) |       18.7 (3.96×) |  4.73 |
| `tiny.ts.txt` (2 KiB)       |                462 | 400 (265×) |       10.1 (6.68×) |  1.51 |
| `small.css.txt` (24 KiB)    |                304 | 267 (264×) |       9.14 (9.01×) |  1.01 |
| `small.html.txt` (28 KiB)   |                694 | 613 (316×) |                  — |  1.94 |
| `small.jsonc.txt` (33 KiB)  |                702 | 632 (162×) |       15.1 (3.87×) |  3.90 |
| `small.ts.txt` (31 KiB)     |                331 | 301 (323×) |       8.21 (8.80×) |  0.93 |
| `large.css.txt` (379 KiB)   |                416 | 297 (244×) |       11.3 (9.26×) |  1.22 |
| `large.html.txt` (474 KiB)  |               1058 | 615 (220×) |                  — |  2.80 |
| `large.jsonc.txt` (292 KiB) |               1031 | 928 (157×) |       25.6 (4.34×) |  5.89 |
| `large.ts.txt` (517 KiB)    |                354 | 320 (298×) |       9.00 (8.40×) |  1.07 |

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
| `tiny.ts.txt` (2 KiB)        |     76 |    6.94 µs |  268 MiB/s | 1013 µs |    146× |
| `small.ts.txt` (31 KiB)      |    826 |     133 µs |  224 MiB/s | 28.5 ms |    214× |
| `large.ts.txt` (517 KiB)     | 10,826 |    2240 µs |  225 MiB/s |  433 ms |    193× |
| `unicode-lines.ts` (527 KiB) | 10,001 |    2273 µs |  227 MiB/s |  378 ms |    166× |

## Streaming

| Input                        |  Lines | Chunks | Highlights | Throughput |   Shiki | Speedup |
| ---------------------------- | -----: | -----: | ---------: | ---------: | ------: | ------: |
| `tiny.css.txt` (2 KiB)       |     85 |      1 |    8.59 µs |  174 MiB/s | 2209 µs |    257× |
| `tiny.html.txt` (2 KiB)      |     51 |      1 |    9.38 µs |  196 MiB/s | 1102 µs |    118× |
| `tiny.jsonc.txt` (2 KiB)     |     66 |      1 |    7.81 µs |  242 MiB/s |  227 µs |   29.1× |
| `tiny.ts.txt` (2 KiB)        |     76 |      1 |    9.09 µs |  205 MiB/s | 1036 µs |    114× |
| `small.css.txt` (24 KiB)     |  1,388 |      6 |     174 µs |  132 MiB/s | 18.5 ms |    106× |
| `small.html.txt` (28 KiB)    |    809 |      7 |     114 µs |  240 MiB/s | 10.9 ms |   96.1× |
| `small.jsonc.txt` (33 KiB)   |  1,105 |      9 |     136 µs |  239 MiB/s | 5192 µs |   38.2× |
| `small.ts.txt` (31 KiB)      |    826 |      8 |     162 µs |  184 MiB/s | 28.6 ms |    176× |
| `large.css.txt` (379 KiB)    | 17,455 |     95 |    2201 µs |  168 MiB/s |  250 ms |    114× |
| `large.html.txt` (474 KiB)   | 11,329 |    119 |    1512 µs |  306 MiB/s |  127 ms |   84.0× |
| `large.jsonc.txt` (292 KiB)  |  8,561 |     74 |     860 µs |  332 MiB/s | 29.4 ms |   34.2× |
| `large.ts.txt` (517 KiB)     | 10,826 |    130 |    2728 µs |  185 MiB/s |  449 ms |    165× |
| `unicode-lines.ts` (527 KiB) | 10,001 |    105 |    2759 µs |  187 MiB/s |  397 ms |    144× |

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
| large.ts (10k lines) | eager init                  | 4717 µs | 5089 µs |              — |             — |
|                      | edit top                    | 0.54 µs | 0.75 µs |        2124 µs |             1 |
|                      | edit middle                 | 0.75 µs | 0.96 µs |        2132 µs |             1 |
|                      | edit end                    | 0.67 µs | 0.87 µs |        2132 µs |             2 |
|                      | insert line                 | 1.21 µs | 1.50 µs |        2141 µs |             3 |
|                      | delete line                 | 0.75 µs | 0.96 µs |        2138 µs |             1 |
|                      | template propagation        | 1320 µs | 1387 µs |         408 µs |        10,824 |
|                      | template + viewport         | 47.1 µs | 66.2 µs |         421 µs |           118 |
|                      | template + distant viewport | 1001 µs | 1008 µs |         409 µs |             0 |
|                      | raw reads ×100              | 3.04 µs | 3.54 µs |              — |             — |
|                      | themed reads ×100           | 17.5 µs | 26.0 µs |              — |             — |
| synthetic 100k lines | eager init                  | 39.0 ms | 39.6 ms |              — |             — |
|                      | edit top                    | 0.63 µs | 0.79 µs |        22.0 ms |             1 |
|                      | edit middle                 | 0.71 µs | 0.87 µs |        21.8 ms |             1 |
|                      | edit end                    | 0.71 µs | 0.87 µs |        21.9 ms |             2 |
|                      | insert line                 | 1.12 µs | 1.37 µs |        22.5 ms |             4 |
|                      | delete line                 | 0.67 µs | 0.83 µs |        22.2 ms |             2 |
|                      | template propagation        | 30.1 ms | 31.2 ms |        20.6 ms |       108,249 |
|                      | template + viewport         | 73.5 µs | 98.0 µs |        20.5 ms |           118 |
|                      | template + distant viewport | 1014 µs | 1025 µs |        20.4 ms |             0 |
|                      | raw reads ×100              | 3.08 µs | 3.71 µs |              — |             — |
|                      | themed reads ×100           | 17.3 µs | 25.5 µs |              — |             — |
| unicode 10k lines    | eager init                  | 3858 µs | 4494 µs |              — |             — |
|                      | edit top                    | 0.71 µs | 0.92 µs |        2264 µs |             1 |
|                      | edit middle                 | 0.79 µs | 1.04 µs |        2272 µs |             1 |
|                      | edit end                    | 0.79 µs | 1.00 µs |        2285 µs |             1 |
|                      | insert line                 | 0.92 µs | 1.17 µs |        2278 µs |             2 |
|                      | delete line                 | 0.63 µs | 0.79 µs |        2267 µs |             1 |
|                      | template propagation        | 1009 µs | 1052 µs |        1040 µs |         9,999 |
|                      | template + viewport         | 46.7 µs | 62.1 µs |        1048 µs |           118 |
|                      | template + distant viewport | 1003 µs | 1018 µs |        1055 µs |             0 |
|                      | raw reads ×100              | 3.12 µs | 3.83 µs |              — |             — |
|                      | themed reads ×100           | 20.0 µs | 30.6 µs |              — |             — |

The next cases use repeated `const value = 1;` lines or one long line of
repeated `x+1;` expressions. Each local or top/end edit includes one raw record
read. Edits to a long line use a viewport of one line.

| Fixture               | Scenario                   |  Median |     p95 |
| --------------------- | -------------------------- | ------: | ------: |
| synthetic 100k lines  | local edit + read          | 0.63 µs | 0.68 µs |
| synthetic 100k lines  | alternating top/end + read | 0.69 µs | 0.73 µs |
| synthetic 1000k lines | local edit + read          | 0.63 µs | 0.68 µs |
| synthetic 1000k lines | alternating top/end + read | 0.68 µs | 0.73 µs |
| 1 MiB dense line      | edit + viewport            | 1308 µs | 1606 µs |
| 5 MiB dense line      | edit + viewport            | 2355 µs | 2422 µs |

The 100k-line document uses 17.4 MiB of Wasm memory. This includes 13.0 MiB of
live heap data and 633 distinct saved lexer states.

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
| 2 KiB → HTML     |     **37** |       80 |        148 |
| 2 KiB → tokens   |     **37** |       78 |        147 |
| 31 KiB → HTML    |     **38** |       91 |        181 |
| 31 KiB → tokens  |     **41** |       91 |        171 |
| 517 KiB → HTML   |     **50** |      155 |        349 |
| 517 KiB → tokens |     **55** |      112 |        303 |
| 5 MiB → HTML     |    **104** |      739 |        963 |
| 5 MiB → tokens   |    **133** |      326 |        488 |

The table shows peak RSS through the first complete call, rounded to whole MiB.
RSS includes the runtime, compiled code, Wasm, and allocator capacity. Both HTML
APIs return complete strings. The Highlights measurement includes UTF-8 decode
time.

Both libraries use GitHub Dark. Shiki's line-length and time limits are
disabled. Token boundaries and styles can differ between the libraries.

Samples run in sequence, with a different engine first in each round. The script
compiles and bundles code outside the measured processes. It deletes the
temporary build afterward. The benchmark does not need a package build.
Highlights includes all its built-in lexers. Shiki loads only TypeScript.

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
