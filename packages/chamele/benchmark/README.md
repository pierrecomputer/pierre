# Chamele benchmarks

These benchmarks compare Chamele with Shiki and `tree-sitter-highlight` across
HTML generation, token output, HAST output, streaming tokenization, and
incremental editor tokenization.

## Run

```sh
moon run chamele:bench
moon run chamele:bench-tokens
moon run chamele:bench-stream
moon run chamele:bench-live
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

| Input                      |        Chamele, bytes |            Chamele | tree-sitter-highlight |                Shiki |
| -------------------------- | --------------------: | -----------------: | --------------------: | -------------------: |
| `small.jsonc.txt` (30 KB)  | **3,529 MB/s (213×)** |  2,643 MB/s (159×) |     50.4 MB/s (3.04×) | 16.6 MB/s (baseline) |
| `tiny.jsonc.txt` (1 KB)    | **1,980 MB/s (119×)** | 1,531 MB/s (92.1×) |     52.2 MB/s (3.14×) | 16.6 MB/s (baseline) |
| `large.jsonc.txt` (292 KB) | **1,281 MB/s (210×)** |  1,123 MB/s (184×) |     24.8 MB/s (4.06×) | 6.10 MB/s (baseline) |
| `tiny.html.txt` (2 KB)     |   **648 MB/s (448×)** |    367 MB/s (254×) |     20.4 MB/s (14.1×) | 1.45 MB/s (baseline) |
| `small.html.txt` (4 KB)    |   **618 MB/s (272×)** |    236 MB/s (104×) |     18.2 MB/s (8.01×) | 2.27 MB/s (baseline) |
| `large.html.txt` (409 KB)  | **573 MB/s (1,760×)** |    251 MB/s (771×) |      36.8 MB/s (113×) | 0.33 MB/s (baseline) |
| `tiny.css.txt` (2 KB)      |   **465 MB/s (725×)** |    362 MB/s (564×) |     12.0 MB/s (18.7×) | 0.64 MB/s (baseline) |
| `large.css.txt` (304 KB)   |   **376 MB/s (375×)** |    213 MB/s (212×) |     9.23 MB/s (9.21×) | 1.00 MB/s (baseline) |
| `large.ts.txt` (466 KB)    |   **375 MB/s (254×)** |    348 MB/s (236×) |     9.66 MB/s (6.54×) | 1.48 MB/s (baseline) |
| `tiny.ts.txt` (1 KB)       |   **361 MB/s (193×)** |    311 MB/s (166×) |     9.17 MB/s (4.90×) | 1.87 MB/s (baseline) |
| `small.css.txt` (24 KB)    |   **337 MB/s (322×)** |    286 MB/s (273×) |     9.13 MB/s (8.72×) | 1.05 MB/s (baseline) |
| `small.ts.txt` (31 KB)     |   **337 MB/s (354×)** |    302 MB/s (317×) |     8.24 MB/s (8.65×) | 0.95 MB/s (baseline) |

> Run on 2026-09-02 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
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
| `tiny.ts.txt` (1 KB)        |     50 | 7.54 µs |   173 MB/s |  583 µs |   77.3× |
| `small.ts.txt` (31 KB)      |    826 |  153 µs |   196 MB/s | 28.2 ms |    185× |
| `large.ts.txt` (466 KB)     | 10,673 | 2.05 ms |   222 MB/s |  263 ms |    128× |
| `unicode-lines.ts` (498 KB) | 10,001 | 2.60 ms |   198 MB/s |  386 ms |    148× |

### `codeToHast`

| Input                       |  Lines | Chamele | Throughput |   Shiki | Speedup |
| --------------------------- | -----: | ------: | ---------: | ------: | ------: |
| `tiny.ts.txt` (1 KB)        |     50 | 22.5 µs |  58.2 MB/s |  612 µs |   27.2× |
| `small.ts.txt` (31 KB)      |    826 |  429 µs |  69.7 MB/s | 28.9 ms |   67.3× |
| `large.ts.txt` (466 KB)     | 10,673 | 5.62 ms |  80.9 MB/s |  269 ms |   47.8× |
| `unicode-lines.ts` (498 KB) | 10,001 | 5.91 ms |  87.1 MB/s |  394 ms |   66.6× |

> Run on 2026-09-02 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
> (macOS arm64). The Unicode fixture contains 10,000 generated lines and
> exercises byte-to-UTF-16 offset conversion.

## Streaming

| Input                       |  Lines | Chunks | Chamele | Throughput |    Shiki | Speedup |
| --------------------------- | -----: | -----: | ------: | ---------: | -------: | ------: |
| `tiny.css.txt` (2 KB)       |     85 |      1 | 9.21 µs |   162 MB/s |  2.22 ms |    241× |
| `tiny.html.txt` (2 KB)      |     51 |      1 | 10.1 µs |   182 MB/s |  1.09 ms |    108× |
| `tiny.jsonc.txt` (1 KB)     |     17 |      1 | 2.46 µs |   571 MB/s |  58.8 µs |   23.9× |
| `tiny.ts.txt` (1 KB)        |     50 |      1 | 7.38 µs |   177 MB/s |   606 µs |   82.1× |
| `small.css.txt` (24 KB)     |  1,388 |      6 |  173 µs |   133 MB/s |  19.3 ms |    111× |
| `small.html.txt` (4 KB)     |      2 |      1 | 20.1 µs |   187 MB/s |  1.34 ms |   66.3× |
| `small.jsonc.txt` (30 KB)   |    337 |      8 | 49.0 µs |   592 MB/s |  1.29 ms |   26.4× |
| `small.ts.txt` (31 KB)      |    826 |      8 |  177 µs |   169 MB/s |  29.2 ms |    165× |
| `large.css.txt` (304 KB)    | 17,619 |     77 | 2.10 ms |   141 MB/s |   256 ms |    122× |
| `large.html.txt` (409 KB)   |     46 |    103 | 2.42 ms |   165 MB/s | 1,195 ms |    494× |
| `large.jsonc.txt` (292 KB)  |  8,561 |     74 |  931 µs |   306 MB/s |  32.6 ms |   35.0× |
| `large.ts.txt` (466 KB)     | 10,673 |    117 | 2.47 ms |   184 MB/s |   269 ms |    109× |
| `unicode-lines.ts` (498 KB) | 10,001 |    105 | 3.68 ms |   140 MB/s |   396 ms |    108× |

> Run on 2026-09-02 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
> (macOS arm64).

Every sample creates a fresh Chamele `StreamTokenizer`. Completed streams return
one reasonably sized Wasm instance to a single-slot pool; active streams remain
isolated. Shiki reuses its highlighter but starts with empty grammar state.
Chamele preserves lexer state between chunks; Shiki carries grammar state
between completed lines.

## Live editing

`LiveTokenizer` keeps the document and per-line lexer states in Wasm. Ordinary
one-character and structural edits converge after one line. The EOF case opens a
template literal near the top of the file and forces state propagation through
the rest of the document; `renderRange` bounds the synchronous work to a
120-line viewport and finishes the tail outside the timed sample.

| Fixture              | Scenario              |  Median |     p95 | Re-tokenized lines |
| -------------------- | --------------------- | ------: | ------: | -----------------: |
| large.ts (10k lines) | eager init            | 4.66 ms | 10.9 ms |                  — |
|                      | edit top              | 2.50 µs | 17.3 µs |                  1 |
|                      | edit middle           | 2.00 µs | 4.67 µs |                  1 |
|                      | edit end              | 1.54 µs | 2.67 µs |                  1 |
|                      | structural edit       | 1.75 µs | 3.75 µs |                  1 |
|                      | EOF propagation       | 2.81 ms | 3.02 ms |             10,671 |
|                      | EOF + renderRange     | 52.3 µs |  124 µs |                118 |
|                      | raw reads ×100        | 9.37 µs | 24.1 µs |                  — |
|                      | themed reads ×100     | 43.1 µs | 65.7 µs |                  — |
|                      | baseline full rebuild | 2.36 ms | 2.73 ms |                  — |
| synthetic 100k lines | eager init            | 36.2 ms | 36.6 ms |                  — |
|                      | edit top              | 1.42 µs | 2.67 µs |                  1 |
|                      | edit middle           | 1.33 µs | 1.75 µs |                  1 |
|                      | edit end              | 1.25 µs | 1.62 µs |                  1 |
|                      | structural edit       | 1.29 µs | 1.75 µs |                  1 |
|                      | EOF propagation       | 28.0 ms | 28.6 ms |             99,998 |
|                      | EOF + renderRange     | 85.4 µs |  119 µs |                118 |
|                      | raw reads ×100        | 6.88 µs | 13.7 µs |                  — |
|                      | themed reads ×100     | 32.2 µs | 42.0 µs |                  — |
|                      | baseline full rebuild | 36.4 ms | 38.1 ms |                  — |
| unicode 10k lines    | eager init            | 3.90 ms | 4.10 ms |                  — |
|                      | edit top              | 1.13 µs | 2.12 µs |                  1 |
|                      | edit middle           | 1.21 µs | 1.67 µs |                  1 |
|                      | edit end              | 1.21 µs | 1.75 µs |                  1 |
|                      | structural edit       | 1.17 µs | 1.58 µs |                  1 |
|                      | EOF propagation       | 2.16 ms | 2.36 ms |              9,999 |
|                      | EOF + renderRange     | 58.5 µs | 69.6 µs |                118 |
|                      | raw reads ×100        | 8.33 µs | 16.4 µs |                  — |
|                      | themed reads ×100     | 32.0 µs | 37.0 µs |                  — |
|                      | baseline full rebuild | 2.52 ms | 2.56 ms |                  — |

The full-rebuild baseline calls Chamele's `codeToTokens` for the complete
document, matching the work the previous `LiveTokenizer` did for every edit. The
100k-line tokenizer retains 20.0 MB of Wasm memory, with 15.7 MB live in the
heap and two interned lexer states. The lexer checkpoint region in each captured
state is 1,056 bytes; captured states are trailing-zero trimmed before storage.

> Run on 2026-09-02 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
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
