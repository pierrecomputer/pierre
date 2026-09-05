# Highlights benchmarks

These benchmarks compare Highlights with Shiki and `tree-sitter-highlight`
across HTML generation, token output, HAST output, streaming tokenization, and
incremental editor tokenization.

## Run

```sh
moon run highlights:bench
moon run highlights:bench-tokens
moon run highlights:bench-stream
moon run highlights:bench-live
```

- `bench` measures end-to-end HTML generation for CSS, HTML, JSONC, and
  TypeScript.
- `bench-tokens` compares the complete `codeToTokens` and `codeToHast` APIs on
  TypeScript.
- `bench-stream` creates fresh per-file state and processes 4,096-character
  chunks, matching Diffs' batching.
- `bench-live` measures `LiveTokenizer` initialization, edits, cached reads,
  convergence, and retained Wasm memory.

Fixtures live in [`fixtures`](./fixtures).

## HTML generation

| Input                      |     Highlights, bytes |        Highlights | tree-sitter-highlight |                Shiki |
| -------------------------- | --------------------: | ----------------: | --------------------: | -------------------: |
| `small.jsonc.txt` (30 KB)  | **3,326 MB/s (213×)** | 2,249 MB/s (144×) |     49.8 MB/s (3.19×) | 15.6 MB/s (baseline) |
| `tiny.jsonc.txt` (1 KB)    | **2,246 MB/s (135×)** | 1,772 MB/s (106×) |     56.2 MB/s (3.37×) | 16.7 MB/s (baseline) |
| `large.jsonc.txt` (292 KB) | **1,174 MB/s (199×)** |   994 MB/s (169×) |     25.3 MB/s (4.30×) | 5.89 MB/s (baseline) |
| `small.html.txt` (4 KB)    |   **640 MB/s (302×)** |   232 MB/s (109×) |     18.7 MB/s (8.81×) | 2.12 MB/s (baseline) |
| `tiny.html.txt` (2 KB)     |   **565 MB/s (386×)** |   386 MB/s (264×) |     21.6 MB/s (14.8×) | 1.46 MB/s (baseline) |
| `large.html.txt` (409 KB)  | **551 MB/s (1,670×)** |   250 MB/s (758×) |      37.2 MB/s (113×) | 0.33 MB/s (baseline) |
| `tiny.css.txt` (2 KB)      |   **407 MB/s (636×)** |   323 MB/s (505×) |     12.6 MB/s (19.6×) | 0.64 MB/s (baseline) |
| `tiny.ts.txt` (1 KB)       |   **398 MB/s (213×)** |   349 MB/s (187×) |     9.66 MB/s (5.17×) | 1.87 MB/s (baseline) |
| `large.ts.txt` (517 KB)    |   **392 MB/s (383×)** |   352 MB/s (345×) |     8.99 MB/s (8.79×) | 1.02 MB/s (baseline) |
| `small.ts.txt` (31 KB)     |   **356 MB/s (401×)** |   312 MB/s (351×) |     7.91 MB/s (8.92×) | 0.89 MB/s (baseline) |
| `large.css.txt` (304 KB)   |   **325 MB/s (343×)** |   174 MB/s (184×) |     8.98 MB/s (9.48×) | 0.95 MB/s (baseline) |
| `small.css.txt` (24 KB)    |   **297 MB/s (283×)** |   258 MB/s (246×) |     9.34 MB/s (8.89×) | 1.05 MB/s (baseline) |

> Run on 2026-09-05 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
> (macOS arm64). Rows are sorted by Highlights byte-API throughput.

Shiki 4.4.1 is the baseline. `Highlights, bytes` receives pre-encoded UTF-8 and
leaves the result as bytes; regular Highlights includes input encoding and
output decoding. `tree-sitter-highlight` 1.1.2 escapes HTML input but emits no
token spans for it, so its HTML rows perform less highlighting work. Themes and
markup differ between tools, making this an end-to-end throughput comparison
rather than a byte-identical output comparison.

## Tokens and HAST

These suites compare Highlights's complete Shiki-compatible APIs against Shiki
on TypeScript. Highlights uses Pierre Dark; Shiki uses GitHub Dark. Neither uses
transformers or decorations.

### `codeToTokens`

| Input                       |  Lines | Highlights | Throughput |   Shiki | Speedup |
| --------------------------- | -----: | ---------: | ---------: | ------: | ------: |
| `tiny.ts.txt` (1 KB)        |     50 |    6.42 µs |   204 MB/s |  573 µs |   89.3× |
| `small.ts.txt` (31 KB)      |    826 |     150 µs |   199 MB/s | 28.0 ms |    187× |
| `large.ts.txt` (517 KB)     | 10,826 |    2.27 ms |   222 MB/s |  429 ms |    189× |
| `unicode-lines.ts` (527 KB) | 10,001 |    2.44 ms |   211 MB/s |  371 ms |    152× |

### `codeToHast`

| Input                       |  Lines | Highlights | Throughput |   Shiki | Speedup |
| --------------------------- | -----: | ---------: | ---------: | ------: | ------: |
| `tiny.ts.txt` (1 KB)        |     50 |    22.2 µs |  59.0 MB/s |  587 µs |   26.4× |
| `small.ts.txt` (31 KB)      |    826 |     436 µs |  68.6 MB/s | 27.4 ms |   62.8× |
| `large.ts.txt` (517 KB)     | 10,826 |    6.38 ms |  79.0 MB/s |  428 ms |   67.1× |
| `unicode-lines.ts` (527 KB) | 10,001 |    5.91 ms |  87.2 MB/s |  385 ms |   65.2× |

> Run on 2026-09-05 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
> (macOS arm64). The Unicode fixture contains 10,000 generated lines and
> exercises byte-to-UTF-16 offset conversion.

## Streaming

| Input                       |  Lines | Chunks | Highlights | Throughput |    Shiki | Speedup |
| --------------------------- | -----: | -----: | ---------: | ---------: | -------: | ------: |
| `tiny.css.txt` (2 KB)       |     85 |      1 |    9.38 µs |   159 MB/s |  2.28 ms |    243× |
| `tiny.html.txt` (2 KB)      |     51 |      1 |    10.3 µs |   178 MB/s |  1.10 ms |    107× |
| `tiny.jsonc.txt` (1 KB)     |     17 |      1 |    2.46 µs |   571 MB/s |  59.5 µs |   24.2× |
| `tiny.ts.txt` (1 KB)        |     50 |      1 |    6.96 µs |   188 MB/s |   600 µs |   86.2× |
| `small.css.txt` (24 KB)     |  1,388 |      6 |     188 µs |   122 MB/s |  19.4 ms |    103× |
| `small.html.txt` (4 KB)     |      2 |      1 |    19.9 µs |   189 MB/s |  1.35 ms |   68.1× |
| `small.jsonc.txt` (30 KB)   |    337 |      8 |    34.5 µs |   839 MB/s |  1.30 ms |   37.7× |
| `small.ts.txt` (31 KB)      |    826 |      8 |     169 µs |   177 MB/s |  29.3 ms |    173× |
| `large.css.txt` (304 KB)    | 17,619 |     77 |    2.27 ms |   131 MB/s |   252 ms |    111× |
| `large.html.txt` (409 KB)   |     46 |    103 |    2.32 ms |   173 MB/s | 1,204 ms |    520× |
| `large.jsonc.txt` (292 KB)  |  8,561 |     74 |     941 µs |   303 MB/s |  32.8 ms |   34.9× |
| `large.ts.txt` (517 KB)     | 10,826 |    130 |    2.74 ms |   184 MB/s |   440 ms |    161× |
| `unicode-lines.ts` (527 KB) | 10,001 |    105 |    2.81 ms |   184 MB/s |   387 ms |    138× |

> Run on 2026-09-05 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
> (macOS arm64).

Every sample creates a fresh Highlights `StreamTokenizer`. Completed streams
return one reasonably sized Wasm instance to a single-slot pool; active streams
remain isolated. Shiki reuses its highlighter but starts with empty grammar
state. Highlights preserves lexer state between chunks; Shiki carries grammar
state between completed lines.

## Live editing

`LiveTokenizer` keeps the document and per-line lexer states in Wasm.
One-character edits converge after one line; structural edits re-tokenize one to
three lines. The EOF case opens a template literal near the top of the file and
forces state propagation through the rest of the document; `renderRange` bounds
the synchronous work to a 120-line viewport and finishes the tail outside the
timed sample.

| Fixture              | Scenario              |  Median |     p95 | Re-tokenized lines |
| -------------------- | --------------------- | ------: | ------: | -----------------: |
| large.ts (10k lines) | eager init            | 4.23 ms | 11.2 ms |                  — |
|                      | edit top              | 2.83 µs | 14.3 µs |                  1 |
|                      | edit middle           | 2.12 µs | 6.67 µs |                  1 |
|                      | edit end              | 0.96 µs | 1.67 µs |                  1 |
|                      | structural edit       | 2.21 µs | 6.83 µs |                  2 |
|                      | EOF propagation       | 2.52 ms | 2.77 ms |             10,824 |
|                      | EOF + renderRange     | 51.8 µs |  109 µs |                118 |
|                      | raw reads ×100        | 8.33 µs | 26.5 µs |                  — |
|                      | themed reads ×100     | 47.2 µs | 76.4 µs |                  — |
|                      | baseline full rebuild | 2.67 ms | 3.22 ms |                  — |
| synthetic 100k lines | eager init            | 33.8 ms | 34.1 ms |                  — |
|                      | edit top              | 1.13 µs | 1.87 µs |                  1 |
|                      | edit middle           | 1.17 µs | 1.75 µs |                  1 |
|                      | edit end              | 1.00 µs | 1.50 µs |                  1 |
|                      | structural edit       | 1.37 µs | 2.00 µs |                  3 |
|                      | EOF propagation       | 25.3 ms | 26.1 ms |            108,249 |
|                      | EOF + renderRange     | 62.6 µs | 78.0 µs |                118 |
|                      | raw reads ×100        | 7.21 µs | 12.3 µs |                  — |
|                      | themed reads ×100     | 28.0 µs | 38.5 µs |                  — |
|                      | baseline full rebuild | 24.1 ms | 26.8 ms |                  — |
| unicode 10k lines    | eager init            | 3.80 ms | 4.15 ms |                  — |
|                      | edit top              | 1.13 µs | 2.17 µs |                  1 |
|                      | edit middle           | 1.46 µs | 2.62 µs |                  1 |
|                      | edit end              | 1.29 µs | 2.08 µs |                  1 |
|                      | structural edit       | 1.04 µs | 1.75 µs |                  1 |
|                      | EOF propagation       | 2.01 ms | 2.14 ms |              9,999 |
|                      | EOF + renderRange     | 57.0 µs | 70.2 µs |                118 |
|                      | raw reads ×100        | 8.17 µs | 14.7 µs |                  — |
|                      | themed reads ×100     | 30.0 µs | 38.7 µs |                  — |
|                      | baseline full rebuild | 2.49 ms | 2.56 ms |                  — |

The full-rebuild baseline calls Highlights's `codeToTokens` for the complete
document, matching the work the previous `LiveTokenizer` did for every edit. The
100k-line tokenizer retains 17.1 MB of Wasm memory, with 13.0 MB live in the
heap and 631 interned lexer states. The lexer checkpoint region in each captured
state is 900 bytes; captured states are trailing-zero trimmed before storage.

> Run on 2026-09-05 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
> (macOS arm64).

## Sampling

The HTML, token, HAST, and streaming cases perform a short warmup, then collect
samples until 1.5 seconds elapse or 2,000 iterations complete, with a minimum of
three samples. Those tables report the median. The live-edit suite uses a fixed
number of rounds per scenario and reports the median and p95. Throughput divides
each fixture's UTF-8 byte size by the median time.

Benchmark results vary with the runtime, hardware, power state, and background
load. Compare tools within the same run rather than across tables measured under
different runtimes.
