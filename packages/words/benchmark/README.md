# Words benchmarks

These benchmarks compare HTML output, React stream updates, and memory use. All
modes use the five Markdown files in [`fixtures`](./fixtures).

## Run

Install workspace dependencies with `pnpm install`. Then run:

```sh
moonx words:bench --ignore-ci-checks
moonx words:bench-stream --ignore-ci-checks
moonx words:bench-memory --ignore-ci-checks
```

- `bench`: HTML strings against md4x (native), md4x (wasm), and markdown-it.
- `bench-stream`: React streams against streamdown in JSDOM.
- `bench-memory`: memory use for all HTML engines and both React engines.

Add `-- --quick` to either timing task for a quick check. Use `-- --samples 1`
for a quick memory check. Add `--fixture tiny.md` to select one input, or
`--json /tmp/words.json` to save raw samples and environment data. Use a
separate JSON file for each mode. Memory also accepts `--mode html` or
`--mode stream`. Both stream comparisons accept `--chunk-size 256`.
 
## HTML generation

Throughput is input MiB per second. Higher is better.

| Fixture                          | @pierre/words | md4x (native) | md4x (wasm) | markdown-it |
| -------------------------------- | ------------: | ------------: | ----------: | ----------: |
| `tiny.md` (1.3 KiB)              |         273.5 |         139.5 |       101.9 |        13.2 |
| `assistant-review.md` (5.4 KiB)  |         350.6 |         202.0 |       159.5 |        21.9 |
| `assistant-explain.md` (6.0 KiB) |         406.6 |         216.9 |       173.4 |        31.3 |
| `simd.md` (39.0 KiB)             |         316.5 |         179.7 |       125.4 |        20.8 |
| `gfm-spec.md` (211.3 KiB)        |         301.6 |         163.1 |       118.3 |        28.8 |

> These results are from **2026-10-31**. The run used Node 24.11.0 on an
> Apple M4 Pro with 48GB RAM. 

## Streaming

Median ms per complete replay in JSDOM. Lower is better. Speedup is the
Streamdown time divided by the Words time.

| Fixture                | Chunks | @pierre/words/react | streamdown | Speedup |
| ---------------------- | -----: | ------------------: | ---------: | ------: |
| `tiny.md`              |      6 |                6.78 |       7.96 |   1.17× |
| `assistant-review.md`  |     22 |               12.46 |      36.01 |   2.89× |
| `assistant-explain.md` |     24 |                7.45 |      12.60 |   1.69× |
| `simd.md`              |    156 |               46.87 |     196.46 |   4.19× |
| `gfm-spec.md`          |    844 |              290.34 |    4364.69 |  15.03× |

Both engines use production React. Each replay creates one React root, then
supplies cumulative Markdown prefixes to the same component. `flushSync` commits
every update. Streamdown retains its block memoization between chunks. Words
retains its HTML session and DOM nodes.

Chunks contain up to 256 UTF-16 code units. A chunk extends by one unit when
necessary to keep a surrogate pair intact. Each prefix uses `mode="streaming"`
and `isAnimating={true}`. One final commit supplies the full document with
`isAnimating={false}`. Both engines retain their default incomplete-Markdown
support.

Controls and line numbers are off. The suite adds no syntax, math, diagram, or
animation plugins. The measured time includes mount and the final commit.
Unmount occurs outside the measured interval. Before measurement, the script
checks that streamed text matches a fresh render from the same engine.

JSDOM measures synchronous parse, React, and DOM work. It does not measure
browser layout, paint, frame rate, or asynchronous animation work. These results
are not browser latency measurements.

## Memory usage

Median peak RSS growth in MiB. Lower is better. Each process subtracts its own
peak RSS before engine import, which is mostly Node itself (75.8 to 79.7 MiB).
Each entry uses five fresh Node processes, for 150 processes in total. HTML and
React results have separate tables because React processes also include JSDOM
and the React runtime.

| Fixture → HTML         | @pierre/words | md4x (native) | md4x (wasm) | markdown-it |
| ---------------------- | ------------: | ------------: | ----------: | ----------: |
| `tiny.md`              |           3.2 |           0.9 |         7.7 |         6.1 |
| `assistant-review.md`  |           3.1 |           0.9 |         7.7 |         6.0 |
| `assistant-explain.md` |           3.2 |           0.9 |         7.8 |         5.7 |
| `simd.md`              |           4.1 |           1.3 |        11.6 |         8.6 |
| `gfm-spec.md`          |           8.3 |           2.5 |        20.2 |        17.7 |

| Fixture → React stream | @pierre/words/react | streamdown |
| ---------------------- | ------------------: | ---------: |
| `tiny.md`              |                76.3 |       85.9 |
| `assistant-review.md`  |                85.8 |      121.0 |
| `assistant-explain.md` |                76.5 |       93.3 |
| `simd.md`              |               109.9 |      146.0 |
| `gfm-spec.md`          |               173.0 |      325.3 |

Samples run in sequence, with a different engine first each round. Build work
occurs outside these processes. Growth covers engine import through the first
HTML call or complete stream replay. It includes module load, native
allocations, Wasm, and allocator capacity. It is not an allocation count.

## Sampling

The timing tasks use [`shared.ts`](./shared.ts). Each case has a 200 ms warmup,
a 1.5-second measurement budget, and at least 20 samples. The engine order
changes each round. HTML samples average calls in batches of approximately 5 ms.
Each stream sample is one complete replay. Cleanup counts toward the budget but
not the measured call time.

The tables use median times. JSON includes p95 and every sample. The p95 value
is the time at or below which 95% of measurements fall.

`--quick` reduces the warmup and measurement budgets to 20 ms and 50 ms, with at
least three measurement samples. Use quick results only to check that the
scripts work. Run the full modes in sequence on an idle machine for comparisons.
