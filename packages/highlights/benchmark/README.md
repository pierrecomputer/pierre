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
Pro (14 cores, 48 GiB RAM, macOS 27.0.1 arm64). That Wasm build measured 396,052
bytes, or 185,279 bytes with gzip. Each table shows one complete run of its
mode.

## HTML generation

Throughput is input MiB per second. Values in parentheses compare the speed with
Shiki when both APIs use strings.

| Input                       | highlights (bytes) | highlights | tree-sitter (NAPI) | shiki |
| --------------------------- | -----------------: | ---------: | -----------------: | ----: |
| `tiny.css.txt` (2 KiB)      |                434 | 358 (568×) |       12.5 (19.8×) |  0.63 |
| `tiny.html.txt` (2 KiB)     |                501 | 409 (288×) |                  — |  1.42 |
| `tiny.jsonc.txt` (2 KiB)    |                818 | 633 (130×) |       18.6 (3.82×) |  4.86 |
| `tiny.ts.txt` (2 KiB)       |                482 | 422 (272×) |       10.0 (6.46×) |  1.55 |
| `small.css.txt` (24 KiB)    |                286 | 253 (247×) |       8.62 (8.44×) |  1.02 |
| `small.html.txt` (28 KiB)   |                657 | 585 (297×) |                  — |  1.97 |
| `small.jsonc.txt` (33 KiB)  |                720 | 646 (163×) |       15.0 (3.77×) |  3.97 |
| `small.ts.txt` (31 KiB)     |                352 | 317 (331×) |       8.28 (8.64×) |  0.96 |
| `large.css.txt` (379 KiB)   |                385 | 284 (231×) |       10.8 (8.76×) |  1.23 |
| `large.html.txt` (474 KiB)  |                997 | 592 (210×) |                  — |  2.82 |
| `large.jsonc.txt` (292 KiB) |               1025 | 849 (139×) |       25.4 (4.16×) |  6.09 |
| `large.ts.txt` (517 KiB)    |                372 | 335 (310×) |       8.93 (8.26×) |  1.08 |

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
| `tiny.ts.txt` (2 KiB)        |     76 |    6.93 µs |  269 MiB/s |  990 µs |    143× |
| `small.ts.txt` (31 KiB)      |    826 |     123 µs |  242 MiB/s | 27.8 ms |    225× |
| `large.ts.txt` (517 KiB)     | 10,826 |    2055 µs |  245 MiB/s |  419 ms |    204× |
| `unicode-lines.ts` (527 KiB) | 10,001 |    1756 µs |  293 MiB/s |  371 ms |    212× |

## Streaming

| Input                        |  Lines | Chunks | Highlights | Throughput |   Shiki | Speedup |
| ---------------------------- | -----: | -----: | ---------: | ---------: | ------: | ------: |
| `tiny.css.txt` (2 KiB)       |     85 |      1 |    8.73 µs |  171 MiB/s | 2182 µs |    250× |
| `tiny.html.txt` (2 KiB)      |     51 |      1 |    9.08 µs |  202 MiB/s | 1089 µs |    120× |
| `tiny.jsonc.txt` (2 KiB)     |     66 |      1 |    7.83 µs |  241 MiB/s |  224 µs |   28.6× |
| `tiny.ts.txt` (2 KiB)        |     76 |      1 |    8.84 µs |  211 MiB/s | 1026 µs |    116× |
| `small.css.txt` (24 KiB)     |  1,388 |      6 |     174 µs |  132 MiB/s | 18.3 ms |    105× |
| `small.html.txt` (28 KiB)    |    809 |      7 |     109 µs |  251 MiB/s | 10.9 ms |   99.9× |
| `small.jsonc.txt` (33 KiB)   |  1,105 |      9 |     131 µs |  248 MiB/s | 5139 µs |   39.2× |
| `small.ts.txt` (31 KiB)      |    826 |      8 |     150 µs |  199 MiB/s | 28.3 ms |    189× |
| `large.css.txt` (379 KiB)    | 17,455 |     95 |    2184 µs |  170 MiB/s |  248 ms |    114× |
| `large.html.txt` (474 KiB)   | 11,329 |    119 |    1387 µs |  334 MiB/s |  125 ms |   90.2× |
| `large.jsonc.txt` (292 KiB)  |  8,561 |     74 |     831 µs |  343 MiB/s | 29.0 ms |   34.8× |
| `large.ts.txt` (517 KiB)     | 10,826 |    130 |    2473 µs |  204 MiB/s |  437 ms |    177× |
| `unicode-lines.ts` (527 KiB) | 10,001 |    105 |    2154 µs |  239 MiB/s |  388 ms |    180× |

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
| large.ts (10k lines) | eager init                  | 4088 µs | 4461 µs |              — |             — |
|                      | edit top                    | 0.46 µs | 0.62 µs |        2087 µs |             1 |
|                      | edit middle                 | 0.67 µs | 0.79 µs |        2003 µs |             1 |
|                      | edit end                    | 0.54 µs | 0.71 µs |        2005 µs |             2 |
|                      | insert line                 | 1.04 µs | 1.17 µs |        2030 µs |             3 |
|                      | delete line                 | 0.67 µs | 0.79 µs |        2025 µs |             1 |
|                      | template propagation        |  828 µs |  852 µs |         409 µs |        10,824 |
|                      | template + viewport         | 35.3 µs | 49.5 µs |         412 µs |           118 |
|                      | template + distant viewport | 1001 µs | 1006 µs |         413 µs |             0 |
|                      | raw reads ×100              | 3.08 µs | 3.58 µs |              — |             — |
|                      | themed reads ×100           | 17.5 µs | 25.8 µs |              — |             — |
| synthetic 100k lines | eager init                  | 32.1 ms | 33.0 ms |              — |             — |
|                      | edit top                    | 0.50 µs | 0.67 µs |        21.0 ms |             1 |
|                      | edit middle                 | 0.62 µs | 0.79 µs |        21.1 ms |             1 |
|                      | edit end                    | 0.54 µs | 0.67 µs |        21.1 ms |             2 |
|                      | insert line                 | 0.83 µs | 0.96 µs |        20.9 ms |             4 |
|                      | delete line                 | 0.50 µs | 0.58 µs |        21.3 ms |             2 |
|                      | template propagation        | 23.6 ms | 24.4 ms |        19.7 ms |       108,249 |
|                      | template + viewport         | 60.7 µs | 84.5 µs |        19.6 ms |           118 |
|                      | template + distant viewport | 1011 µs | 1020 µs |        19.4 ms |             0 |
|                      | raw reads ×100              | 3.13 µs | 3.62 µs |              — |             — |
|                      | themed reads ×100           | 17.6 µs | 25.2 µs |              — |             — |
| unicode 10k lines    | eager init                  | 3059 µs | 3403 µs |              — |             — |
|                      | edit top                    | 0.58 µs | 0.75 µs |        1790 µs |             1 |
|                      | edit middle                 | 0.67 µs | 0.83 µs |        1792 µs |             1 |
|                      | edit end                    | 0.67 µs | 0.83 µs |        1792 µs |             1 |
|                      | insert line                 | 0.71 µs | 0.87 µs |        1792 µs |             2 |
|                      | delete line                 | 0.54 µs | 0.67 µs |        1807 µs |             1 |
|                      | template propagation        |  595 µs |  614 µs |         699 µs |         9,999 |
|                      | template + viewport         | 39.6 µs | 52.8 µs |         702 µs |           118 |
|                      | template + distant viewport | 1001 µs | 1002 µs |         700 µs |             0 |
|                      | raw reads ×100              | 3.13 µs | 3.58 µs |              — |             — |
|                      | themed reads ×100           | 20.3 µs | 30.0 µs |              — |             — |

The next cases use repeated `const value = 1;` lines or one long line of
repeated `x+1;` expressions. Each local or top/end edit includes one raw record
read. Edits to a long line use a viewport of one line.

| Fixture               | Scenario                   |  Median |     p95 |
| --------------------- | -------------------------- | ------: | ------: |
| synthetic 100k lines  | local edit + read          | 0.55 µs | 0.56 µs |
| synthetic 100k lines  | alternating top/end + read | 0.57 µs | 0.59 µs |
| synthetic 1000k lines | local edit + read          | 0.52 µs | 0.55 µs |
| synthetic 1000k lines | alternating top/end + read | 0.59 µs | 0.60 µs |
| 1 MiB dense line      | edit + viewport            | 1281 µs | 1305 µs |
| 5 MiB dense line      | edit + viewport            | 2267 µs | 2290 µs |

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
| 2 KiB → HTML     |     **40** |       79 |        151 |
| 2 KiB → tokens   |     **41** |       79 |        149 |
| 31 KiB → HTML    |     **43** |       91 |        176 |
| 31 KiB → tokens  |     **47** |       91 |        171 |
| 517 KiB → HTML   |     **55** |      156 |        351 |
| 517 KiB → tokens |     **61** |      113 |        304 |
| 5 MiB → HTML     |    **111** |      738 |        956 |
| 5 MiB → tokens   |    **136** |      326 |        492 |

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
