# Words benchmarks

These benchmarks compare HTML output, React stream updates, memory use, and
browser rendering. The Node modes use the five Markdown files in
[`fixtures`](./fixtures). The browser mode uses the repeated document from
[`fixtures/index.ts`](./fixtures/index.ts), which the `/words` demo also uses.

## Run

```sh
moonx words:bench --ignore-ci-checks
moonx words:bench-stream --ignore-ci-checks
moonx words:bench-memory --ignore-ci-checks
moonx words:bench-browser --ignore-ci-checks
```

- `bench`: HTML strings against md4x (native), md4x (wasm), and markdown-it.
- `bench-stream`: React streams against Streamdown in JSDOM.
- `bench-memory`: memory use of all HTML engines and both React engines.
- `bench-browser`: React streams against Streamdown in Chromium, and download
  size. These results feed the charts on the `/words` page.

Pass options after `--`:

| Option              | Tasks                 | Purpose                                                                   |
| ------------------- | --------------------- | ------------------------------------------------------------------------- |
| `--quick`           | timing, browser       | Short check that the scripts work. Do not compare these numbers.          |
| `--samples 1`       | memory                | Short check that the script works.                                        |
| `--fixture tiny.md` | bench, stream, memory | Use one input.                                                            |
| `--chunk-size 256`  | stream, memory        | UTF-16 code units per chunk.                                              |
| `--mode html`       | memory                | Run only `html` or `stream`.                                              |
| `--json out.json`   | all                   | Save raw samples and environment data. Use a separate file for each task. |
| `--docs`            | browser               | Write `apps/docs/public/words/benchmark.json` and `benchmark-raw.json`.   |

`bench-browser` uses the Chromium build that Playwright pins. Install it once
with `pnpm --filter @pierre/words exec playwright install chromium`.

## HTML generation

Input MiB per second. Higher is better.

| Fixture                          | @pierre/words | md4x (native) | md4x (wasm) | markdown-it |
| -------------------------------- | ------------: | ------------: | ----------: | ----------: |
| `tiny.md` (1.3 KiB)              |         318.1 |         143.9 |       105.4 |        14.2 |
| `assistant-review.md` (5.4 KiB)  |         384.8 |         208.7 |       166.6 |        23.4 |
| `assistant-explain.md` (6.0 KiB) |         441.0 |         221.4 |       178.8 |        32.8 |
| `simd.md` (39.0 KiB)             |         371.5 |         190.1 |       132.8 |        22.8 |
| `gfm-spec.md` (211.3 KiB)        |         370.3 |         175.7 |       126.6 |        31.0 |

> Measured on **2026-11-02** at commit `6b6adede` with Node 24.11.0 on an Apple
> M4 Pro with 48 GiB RAM.

## Streaming

Median ms per complete replay in JSDOM. Lower is better. Speedup is the
Streamdown time divided by the Words time.

| Fixture                | Chunks | @pierre/words/react | streamdown | Speedup |
| ---------------------- | -----: | ------------------: | ---------: | ------: |
| `tiny.md`              |      6 |                3.35 |       6.84 |   2.04× |
| `assistant-review.md`  |     22 |               11.27 |      31.56 |   2.80× |
| `assistant-explain.md` |     24 |                6.53 |      10.92 |   1.67× |
| `simd.md`              |    156 |               45.25 |     181.71 |   4.02× |
| `gfm-spec.md`          |    844 |              281.06 |    4385.23 |  15.60× |

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
peak RSS before the engine import, which is mostly Node itself (75.8 to 79.5
MiB). Each entry uses five fresh Node processes, for 150 in total. React
processes also include JSDOM and the React runtime, so React has its own table.

| Fixture → HTML         | @pierre/words | md4x (native) | md4x (wasm) | markdown-it |
| ---------------------- | ------------: | ------------: | ----------: | ----------: |
| `tiny.md`              |           3.2 |           0.9 |         7.7 |         6.2 |
| `assistant-review.md`  |           3.1 |           0.9 |         7.7 |         6.0 |
| `assistant-explain.md` |           3.2 |           0.9 |         7.7 |         5.7 |
| `simd.md`              |           3.5 |           1.4 |        11.5 |         8.7 |
| `gfm-spec.md`          |           8.7 |           2.6 |        22.1 |        17.7 |

| Fixture → React stream | @pierre/words/react | streamdown |
| ---------------------- | ------------------: | ---------: |
| `tiny.md`              |                75.6 |       87.0 |
| `assistant-review.md`  |                85.0 |      121.7 |
| `assistant-explain.md` |                76.3 |       94.4 |
| `simd.md`              |               109.6 |      145.5 |
| `gfm-spec.md`          |               201.4 |      328.9 |

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
| 1× plain           |          0.4 |               1.1 |         9.1 |              9.2 |        0.6 |             3.1 |
| 1× highlighting    |          1.7 |               2.2 |         9.2 |              9.1 |        0.7 |             3.9 |
| 1× fades           |          1.5 |               4.7 |         9.3 |              9.2 |        0.9 |             6.0 |
| 100× plain         |          1.7 |              25.6 |         9.3 |             16.7 |        3.6 |           126.0 |
| 100× highlighting  |          2.2 |              25.2 |         9.9 |             16.7 |        6.0 |           142.3 |
| 100× fades         |         13.2 |              44.7 |        16.8 |             91.6 |        8.2 |           237.3 |
| 1000× highlighting |          4.1 |             228.9 |       141.6 |            291.6 |       51.2 |          1397.9 |
| 1000× fades        |        208.3 |         timed out |       234.1 |                — |       67.3 |               — |

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
  playback. This display runs at 120 Hz.
- Heap growth is the V8 heap after two forced garbage collections, from the
  warmed empty renderer to the settled document. It does not include native DOM,
  Wasm, or graphics memory.
- Words uses `@pierre/words/highlights` with the Pierre themes. Streamdown uses
  `@streamdown/code` with its default themes. Fades last 180 ms. Words fades
  each delivered chunk, including code. Streamdown fades prose words.
- A run counts only if the page has no errors, every update commits, the
  paragraph and code block counts are correct, every code block is highlighted,
  and both libraries show the same text.

| Download, gzip KB              | @pierre/words | streamdown |
| ------------------------------ | ------------: | ---------: |
| Base React renderer            |          50.4 |      165.3 |
| With TypeScript and two themes |         254.4 |      244.9 |
| CSS                            |           1.2 |        0.4 |

Download size uses minified `Bun.build` output with React external, with each JS
file gzipped at level 9. The base row counts static imports only. The second row
adds the chunks that Streamdown loads on demand for TypeScript, its two themes,
and highlighted code. Words keeps all grammars in one file.

> Measured on **2026-11-03** at commit `43311732` with uncommitted changes, Bun
> 1.4.0, and Chromium 134.0.6998.35 on an Apple M4 Pro with 48 GiB RAM.

## Sampling

The timing tasks use [`shared.ts`](./shared.ts). Each case has a 200 ms warmup,
a 1.5-second budget, and at least 20 samples, and the engine order changes each
round. HTML samples average calls in batches of about 5 ms. Each stream sample
is one complete replay. Cleanup counts toward the budget but not the measured
time.

The tables use medians. The JSON also has p95 and every sample. `--quick` cuts
the warmup and budget to 20 ms and 50 ms, with at least three samples. For
comparisons, run the full tasks in sequence on an idle machine.
