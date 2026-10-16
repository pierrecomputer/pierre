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
| `createTwoFilesPatch`             | 779 KB |   208 MB/s | **2871 MB/s (13.8×)** |
| `createTwoFilesPatch` (divergent) | 244 KB |  3.32 MB/s |  **185 MB/s (55.5×)** |
| `diffLines`                       | 779 KB |   223 MB/s | **2993 MB/s (13.4×)** |
| `diffWordsWithSpace`              | 154 KB |  31.7 MB/s |  **522 MB/s (16.5×)** |
| `diffWordsWithSpace` (Unicode)    |  94 KB |  40.5 MB/s |  **358 MB/s (8.84×)** |
| `diffChars`                       |  51 KB |  55.8 MB/s | **1428 MB/s (25.6×)** |
| `diffChars` (Unicode)             |  24 KB |  20.5 MB/s |  **379 MB/s (18.5×)** |
| `diffWordsWithSpace` (per line)   | 213 KB |  42.7 MB/s |  **266 MB/s (6.22×)** |
| `diffChars` (per line)            | 213 KB |  10.3 MB/s |  **182 MB/s (17.6×)** |

> Measured on 2026-10-15 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
> (macOS arm64).

## Memory Usage

Lower is better. Memory is all the memory that one call allocates, with the
garbage collector off. For @pierre/patches, this includes the wasm memory.

| API / input                       |   Size | diff@9.0.0 | @pierre/patches |
| --------------------------------- | -----: | ---------: | --------------: |
| `createTwoFilesPatch`             | 779 KB |    6.61 MB |     **1.48 MB** |
| `createTwoFilesPatch` (divergent) | 244 KB |    77.8 MB |     **3.39 MB** |
| `diffLines`                       | 779 KB |    5.53 MB |     **1.38 MB** |
| `diffWordsWithSpace`              | 154 KB |    5.33 MB |     **1.78 MB** |
| `diffWordsWithSpace` (Unicode)    |  94 KB |    2.67 MB |     **1.55 MB** |
| `diffChars`                       |  51 KB |    2.84 MB |     **0.56 MB** |
| `diffChars` (Unicode)             |  24 KB |    1.80 MB |     **0.25 MB** |
| `diffWordsWithSpace` (per line)   | 213 KB |    8.73 MB |     **0.75 MB** |
| `diffChars` (per line)            | 213 KB |    31.4 MB |     **1.06 MB** |

> Measured on 2026-10-15 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
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

For memory, [`memory.ts`](./memory.ts) runs in a new Bun process with
`BUN_JSC_useGC=0`. After 5 warmup calls, it measures how much the RSS grows in
one call. @pierre/patches gets a new wasm instance first, so its wasm memory is
counted. The result is the median of 3 processes.

The chart uses the 779 KB `createTwoFilesPatch` case.
