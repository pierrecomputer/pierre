# Words benchmarks

These benchmarks compare HTML output, React stream updates, memory use, and
browser rendering. The Node modes use the five Markdown files in
[`fixtures`](./fixtures). The browser mode uses the repeated document from
[`fixtures/index.ts`](./fixtures/index.ts), which the `/words` demo also uses.
Recorded measurement dates use UTC.

## Run

```sh
moonx words:bench --ignore-ci-checks
moonx words:bench-stream --ignore-ci-checks
moonx words:bench-memory --ignore-ci-checks
moonx words:bench-browser --ignore-ci-checks
moonx words:bench-download --ignore-ci-checks
```

- `bench`: HTML strings against md4x (NAPI), md4x (wasm), and markdown-it.
- `bench-stream`: React streams against Streamdown in JSDOM.
- `bench-memory`: memory use of all HTML engines and both React engines.
- `bench-browser`: React streams against Streamdown in Chromium, and download
  size. These results feed the charts on the `/words` page.
- `bench-download`: download size only, using the same production bundles as the
  browser benchmark. This leaves the recorded browser timings unchanged.

Pass options after `--`:

| Option              | Tasks                 | Purpose                                                                                     |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| `--quick`           | timing, browser       | Short check that the scripts work. Do not compare these numbers.                            |
| `--samples 1`       | memory                | Short check that the script works.                                                          |
| `--fixture tiny.md` | bench, stream, memory | Use one input.                                                                              |
| `--chunk-size 256`  | stream, memory        | UTF-16 code units per chunk.                                                                |
| `--mode html`       | memory                | Run only `html` or `stream`.                                                                |
| `--json out.json`   | all                   | Save raw samples and environment data. Use a separate file for each task.                   |
| `--docs`            | browser, download     | Write charts and raw results; download updates only size measurements and their provenance. |

`bench-browser` uses the Chromium build that Playwright pins. Install it once
with `pnpm --filter @pierre/words exec playwright install chromium`.

## HTML generation

Input MiB per second. Higher is better.

| Fixture                          | @pierre/words | md4x (NAPI) | md4x (wasm) | markdown-it |
| -------------------------------- | ------------: | ----------: | ----------: | ----------: |
| `tiny.md` (1.3 KiB)              |         326.9 |       139.7 |       102.6 |        13.6 |
| `assistant-review.md` (5.4 KiB)  |         382.6 |       198.9 |       158.6 |        21.8 |
| `assistant-explain.md` (6.0 KiB) |         437.5 |       212.5 |       170.3 |        30.5 |
| `simd.md` (39.0 KiB)             |         366.1 |       178.4 |       123.9 |        20.9 |
| `gfm-spec.md` (211.3 KiB)        |         366.1 |       168.5 |       121.9 |        29.7 |

> Measured on **2026-11-10** at commit `8b0ad8f3` with Node 24.11.0 on Apple M4
> Max with 128 GiB RAM.

## Streaming

Median ms per complete replay in JSDOM. Lower is better. Speedup is the
Streamdown time divided by the Words time.

| Fixture                | Chunks | @pierre/words/react | streamdown | Speedup |
| ---------------------- | -----: | ------------------: | ---------: | ------: |
| `tiny.md`              |      6 |                3.29 |       7.17 |   2.18× |
| `assistant-review.md`  |     22 |               10.25 |      34.48 |   3.36× |
| `assistant-explain.md` |     24 |                5.99 |      11.16 |   1.86× |
| `simd.md`              |    156 |               41.48 |     186.50 |   4.50× |
| `gfm-spec.md`          |    844 |              279.56 |    4511.27 |  16.14× |

Each replay creates one production React root and passes growing Markdown
prefixes to the same component, with `flushSync` after every update. Streamdown
keeps its block memoization between chunks, and Words keeps its HTML session and
DOM nodes.

Chunks hold up to 256 UTF-16 code units, plus one more if needed to keep a
surrogate pair together. Each prefix uses `mode="streaming"` and
`isAnimating={true}`. A final commit passes the full document with
`isAnimating={false}`. Both engines use their default incomplete-Markdown
support.

Controls and line numbers are off, and there are no syntax, math, diagram, or
animation plugins. The time includes mount and the final commit, but not
unmount. Before measuring, the script checks that streamed text matches a fresh
render from the same engine.

JSDOM measures synchronous parse, React, and DOM work. It does not measure
layout, paint, frame rate, or asynchronous animation, so see [Browser](#browser)
for those.

## Memory usage

Median peak RSS growth in MiB. Lower is better. Each process subtracts its own
peak RSS before the engine import, which is mostly Node itself (76.0 to 80.0
MiB). Each entry uses five fresh Node processes, for 150 in total. React
processes also include JSDOM and the React runtime, so React has its own table.

| Fixture → HTML         | @pierre/words | md4x (NAPI) | md4x (wasm) | markdown-it |
| ---------------------- | ------------: | ----------: | ----------: | ----------: |
| `tiny.md`              |           3.2 |         1.0 |         7.7 |         6.2 |
| `assistant-review.md`  |           3.2 |         1.0 |         7.8 |         5.9 |
| `assistant-explain.md` |           3.2 |         0.9 |         7.8 |         6.0 |
| `simd.md`              |           3.5 |         1.4 |        11.8 |         8.6 |
| `gfm-spec.md`          |           8.6 |         2.7 |        20.7 |        18.0 |

| Fixture → React stream | @pierre/words/react | streamdown |
| ---------------------- | ------------------: | ---------: |
| `tiny.md`              |                76.2 |       86.3 |
| `assistant-review.md`  |                85.0 |      122.2 |
| `assistant-explain.md` |                76.6 |       93.4 |
| `simd.md`              |               110.6 |      149.1 |
| `gfm-spec.md`          |               203.4 |      333.0 |

Samples run in sequence, with a different engine first each round. Growth covers
engine import through the first HTML call or complete stream replay. It includes
module load, native allocations, Wasm, and allocator capacity. It is not an
allocation count.

## Browser

Median of each run's 95th percentile, from three runs in fresh Chromium
processes. Update and frame times are in ms, and heap growth is in MB. Lower is
better.

| Document           | Words update | Streamdown update | Words frame | Streamdown frame | Words heap | Streamdown heap |
| ------------------ | -----------: | ----------------: | ----------: | ---------------: | ---------: | --------------: |
| 1× plain           |          1.0 |               3.4 |        17.6 |             17.6 |        0.6 |             3.1 |
| 1× highlighting    |          1.1 |               3.1 |        17.6 |             17.6 |        0.7 |             3.9 |
| 1× fades           |          1.2 |               3.5 |        17.6 |             17.6 |        0.9 |             6.0 |
| 100× plain         |          1.1 |              24.7 |        17.5 |             17.4 |        4.1 |           126.0 |
| 100× highlighting  |          2.0 |              26.9 |        17.6 |             17.6 |        5.7 |           142.9 |
| 100× fades         |          6.8 |              41.9 |        17.6 |             83.4 |        7.6 |           236.6 |
| 1000× highlighting |          3.4 |             226.2 |       133.4 |            283.5 |       36.0 |          1397.2 |
| 1000× fades        |        172.7 |         timed out |       200.1 |                — |       53.9 |               — |

The 1× document has 8,524 characters: 100 paragraphs and one TypeScript code
block with 40 lines. Larger documents repeat it. Fades include highlighting. The
1000× rows are single runs, stopped after 180 seconds.

Each library gets a production page built with `Bun.build`. Each run opens a new
browser with a 1280 × 960 viewport. The page first renders a short warmup
document, so startup and the first grammar load are not measured. It then mounts
an empty renderer and adds `32 × scale` characters 40 ms after each commit, for
267 updates.

- Update time runs from the state update to the parent's layout effect, after
  both renderers have written the DOM. It does not include paint.
- Frame time is the interval between `requestAnimationFrame` callbacks during
  playback. Frame times depend on the browser's rendering cadence and the host
  display.
- Heap growth is the V8 heap after two forced garbage collections, from the
  warmed empty renderer to the settled document. It does not include native DOM,
  Wasm, or graphics memory.
- Words uses `@pierre/words/highlights` with the Pierre themes. Streamdown uses
  `@streamdown/code` with its default themes. Fades last 180 ms. Words fades
  each delivered chunk, including code. Streamdown fades prose words.
- A run counts only if the page has no errors, every update commits, the
  paragraph and code block counts are correct, every code block is highlighted,
  and both libraries show the same text.

> Browser timing and heap measured on **2026-11-10** at commit `8b0ad8f3` with
> Bun 1.4.0 and Chromium 134.0.6998.35 on Apple M4 Max with 128 GiB RAM.

| Download, gzip KB                   | @pierre/words | streamdown |
| ----------------------------------- | ------------: | ---------: |
| Base React renderer · initial load  |          50.8 |      165.3 |
| 186 shared languages · loaded total |         302.0 |     1179.0 |
| CSS                                 |           1.2 |        0.4 |

Download size uses minified `Bun.build` output with React external, with each JS
file gzipped at level 9. Each loaded chunk is counted once, including its static
dependencies. Unrequested dynamic imports are excluded. The base row counts
static imports only.

The shared-language row requests the 186 canonical languages supported by both
libraries, resolving aliases without counting them as extra languages. Both use
GitHub light/dark. Words still includes all 190 built-in languages; CUDA, GROQ,
PromQL, and TSRX have no matching Shiki language. Streamdown also loads the
required embedded grammar dependencies of those 186 requests. Its remaining
languages, optional embedded languages, and unused themes are excluded.

The shared-language row measures cumulative transfer after the specified
languages have loaded. Streamdown loads languages on demand, so a page using
fewer languages downloads less than the shared-language total. This comparison
matches language requests, not each highlighter's tokenization or grammar
implementation.

Download sizes are measured independently of browser timings. The `downloadRun`
in [`benchmark.json`](../../../apps/docs/public/words/benchmark.json) records
their date, source commit, Bun version, and dependency versions.
`downloadCoverage` records the canonical language mapping, unmatched languages,
shared themes, and loaded Streamdown grammar IDs so the scope can be audited.

> Download sizes measured on **2026-11-11** with Bun 1.4.0. The exact source
> commit is recorded in `downloadRun`.

## Sampling

The timing tasks use [`shared.ts`](./shared.ts). Each case has a 200 ms warmup,
a 1.5-second budget, and at least 20 samples, and the engine order changes each
round. HTML samples average calls in batches of about 5 ms. Each stream sample
is one complete replay. Cleanup counts toward the budget but not the measured
time.

The tables use medians. The JSON also has p95 and every sample. `--quick` cuts
the warmup and budget to 20 ms and 50 ms, with at least three samples. For
comparisons, run the full tasks in sequence on an idle machine.
