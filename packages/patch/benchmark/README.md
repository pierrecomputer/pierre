# Benchmark

This benchmark compares throughput and memory with
[`diff@9.0.0`](https://github.com/kpdecker/jsdiff). Before it measures, it
checks that the two libraries give the same output. If the output is different,
it stops.

```sh
moonx patch:bench
moonx patch:bench -- --chart    # also update benchmark-{light,dark}.svg
moonx patch:bench -- --memory   # also measure the memory that one call allocates
```

## Throughput

Higher is better. Size is the UTF-8 size of the old and new strings together.
The number in parentheses is the speedup over `diff@9.0.0`.

| API / input                       |   Size | diff@9.0.0 |         @pierre/patch |
| --------------------------------- | -----: | ---------: | --------------------: |
| `createTwoFilesPatch`             | 779 KB |   177 MB/s | **1855 MB/s (10.5×)** |
| `createTwoFilesPatch` (divergent) | 244 KB |  2.95 MB/s |  **101 MB/s (34.2×)** |
| `diffLines`                       | 779 KB |   184 MB/s | **1891 MB/s (10.3×)** |
| `diffWordsWithSpace`              | 154 KB |  28.9 MB/s |  **296 MB/s (10.3×)** |
| `diffWordsWithSpace` (Unicode)    |  94 KB |  35.6 MB/s |  **256 MB/s (7.19×)** |
| `diffChars`                       |  51 KB |  50.3 MB/s | **1135 MB/s (22.6×)** |
| `diffChars` (Unicode)             |  24 KB |  18.8 MB/s |  **293 MB/s (15.6×)** |
| `diffWordsWithSpace` (per line)   | 213 KB |  37.6 MB/s |  **177 MB/s (4.71×)** |
| `diffChars` (per line)            | 213 KB |  9.66 MB/s |  **152 MB/s (15.8×)** |

> Measured on 2026-10-14 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
> (macOS arm64).

## Memory Usage

Lower is better. Memory is all the memory that one call allocates, with the
garbage collector off. For @pierre/patch, this includes the wasm memory.

| API / input                       |   Size | diff@9.0.0 | @pierre/patch |
| --------------------------------- | -----: | ---------: | ------------: |
| `createTwoFilesPatch`             | 779 KB |    6.80 MB |   **1.73 MB** |
| `createTwoFilesPatch` (divergent) | 244 KB |    77.7 MB |   **6.05 MB** |
| `diffLines`                       | 779 KB |    5.77 MB |   **1.59 MB** |
| `diffWordsWithSpace`              | 154 KB |    5.23 MB |   **2.45 MB** |
| `diffWordsWithSpace` (Unicode)    |  94 KB |    2.70 MB |   **2.08 MB** |
| `diffChars`                       |  51 KB |    2.92 MB |   **0.58 MB** |
| `diffChars` (Unicode)             |  24 KB |    1.80 MB |   **0.30 MB** |
| `diffWordsWithSpace` (per line)   | 213 KB |    8.78 MB |   **1.69 MB** |
| `diffChars` (per line)            | 213 KB |    30.8 MB |   **2.05 MB** |

> Measured on 2026-10-14 with Bun 1.4.0 on a 14-core Apple M4 Pro with 48 GB RAM
> (macOS arm64).

jsdiff makes garbage that the garbage collector must clean up after each call.
@pierre/patch keeps its wasm memory for the next call, up to 32 MB
(`setMemoryLimit`), so it grows only when an input needs more memory than all
inputs before it.

## Method

[`fixtures.ts`](./fixtures.ts) makes the input from a fixed seed, so each run
uses the same input. The WAT in `src/` is built the same way as
`moonx patch:build`. The "per line" inputs are 2,000 pairs of edited code lines,
diffed one pair at a time, as a diff viewer does for inline change highlights.

For throughput, each function gets 5 warmup calls, then runs until 1.2 seconds
pass or 2,000 calls are done. Throughput is the input size divided by the median
time per call (1 MB = 1,024² bytes).

For memory, [`memory.ts`](./memory.ts) runs in a new Bun process with
`BUN_JSC_useGC=0`. After 5 warmup calls, it measures how much the RSS grows in
one call. @pierre/patch gets a new wasm instance first, so its wasm memory is
counted. The result is the median of 3 processes.

The chart uses the 779 KB `createTwoFilesPatch` case.
