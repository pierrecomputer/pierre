# Benchmark

This benchmark compares throughput and memory with
[`diff@9.0.0`](https://github.com/kpdecker/jsdiff). Before it measures, it
checks that the two libraries give the same output. If the output is different,
it stops.

```sh
moonx patches:bench
moonx patches:bench -- --chart    # also update benchmark-{light,dark}.svg
moonx patches:bench -- --memory   # also measure the memory that one call allocates
```

## Throughput

Higher is better. Size is the UTF-8 size of the old and new strings together.
The number in parentheses is the speedup over `diff@9.0.0`.

| API / input                       |   Size | diff@9.0.0 |       @pierre/patches |
| --------------------------------- | -----: | ---------: | --------------------: |
| `createTwoFilesPatch`             | 779 KB |   202 MB/s | **2878 MB/s (14.2×)** |
| `createTwoFilesPatch` (divergent) | 244 KB |  3.24 MB/s |  **184 MB/s (56.8×)** |
| `diffLines`                       | 779 KB |   217 MB/s | **2976 MB/s (13.7×)** |
| `diffWordsWithSpace`              | 154 KB |  31.4 MB/s |  **516 MB/s (16.4×)** |
| `diffWordsWithSpace` (Unicode)    |  94 KB |  40.3 MB/s |  **355 MB/s (8.81×)** |
| `diffChars`                       |  51 KB |  55.6 MB/s | **1550 MB/s (27.9×)** |
| `diffChars` (Unicode)             |  24 KB |  20.3 MB/s |  **380 MB/s (18.7×)** |
| `diffWordsWithSpace` (per line)   | 213 KB |  41.8 MB/s |  **259 MB/s (6.20×)** |
| `diffChars` (per line)            | 213 KB |  10.1 MB/s |  **183 MB/s (18.1×)** |

> Measured on 2026-11-04 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
> (macOS arm64).

## Memory Usage

Lower is better. Memory is all the memory that one call allocates, with the
garbage collector off. For @pierre/patches, this includes the wasm memory.

| API / input                       |   Size | diff@9.0.0 | @pierre/patches |
| --------------------------------- | -----: | ---------: | --------------: |
| `createTwoFilesPatch`             | 779 KB |    6.95 MB |     **1.56 MB** |
| `createTwoFilesPatch` (divergent) | 244 KB |    77.8 MB |     **3.47 MB** |
| `diffLines`                       | 779 KB |    5.75 MB |     **1.44 MB** |
| `diffWordsWithSpace`              | 154 KB |    5.28 MB |     **1.84 MB** |
| `diffWordsWithSpace` (Unicode)    |  94 KB |    2.66 MB |     **1.61 MB** |
| `diffChars`                       |  51 KB |    2.94 MB |     **0.63 MB** |
| `diffChars` (Unicode)             |  24 KB |    1.80 MB |     **0.34 MB** |
| `diffWordsWithSpace` (per line)   | 213 KB |    8.73 MB |     **0.81 MB** |
| `diffChars` (per line)            | 213 KB |    30.3 MB |     **1.11 MB** |

> Measured on 2026-11-04 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
> (macOS arm64).

jsdiff makes garbage that the garbage collector must clean up after each call.
@pierre/patches keeps its wasm memory for the next call, up to 32 MB
(`setMemoryLimit`), so it grows only when an input needs more memory than all
inputs before it.

## Method

[`fixtures.ts`](./fixtures.ts) makes the input from a fixed seed, so each run
uses the same input. The WAT in `src/` is built the same way as
`moonx patches:build`. The "per line" inputs are 2,000 pairs of edited code
lines, diffed one pair at a time, as a diff viewer does for inline change
highlights.

For throughput, each function gets 5 warmup calls, then runs until 1.2 seconds
pass or 2,000 calls are done. Throughput is the input size divided by the median
time per call (1 MB = 1,024² bytes).

The tables show the median of 3 benchmark runs.

For memory, [`memory.ts`](./memory.ts) runs in a new Bun process with
`BUN_JSC_useGC=0`. After 5 warmup calls, it measures how much the RSS grows in
one call. @pierre/patches gets a new wasm instance first, so its wasm memory is
counted. The result is the median of 3 processes.

The chart uses the 779 KB `createTwoFilesPatch` case.
