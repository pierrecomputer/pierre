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
peak RSS before engine import, which is mostly Node itself (75.8 to 79.5 MiB).
Each entry uses five fresh Node processes, for 150 processes in total. HTML and
React results have separate tables because React processes also include JSDOM
and the React runtime.

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
