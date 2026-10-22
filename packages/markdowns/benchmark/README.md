# Benchmark

Throughput against [md4x](https://github.com/unjs/md4x) (MD4C, native and Wasm)
and [markdown-it](https://github.com/markdown-it/markdown-it).

```sh
moonx markdowns:bench
moonx markdowns:bench -- --chart   # write benchmark-{light,dark}.svg for the README
```

## Results

String in and HTML string out, except `bytes io`, which accepts a `Uint8Array`
and returns a view of Wasm memory. Higher is better. Parentheses are speedup
over markdown-it.

| Input                              | @pierre/markdowns bytes io | @pierre/markdowns |      md4x native |        md4x wasm |          markdown-it |
| ---------------------------------- | -------------------------: | ----------------: | ---------------: | ---------------: | -------------------: |
| `tiny.md` (1.33 KB)                |       **358 MB/s (23.9×)** |  256 MB/s (17.1×) | 146 MB/s (9.77×) | 109 MB/s (7.28×) | 15.0 MB/s (baseline) |
| `small.md` (39.0 KB)               |       **561 MB/s (23.2×)** |  373 MB/s (15.4×) | 198 MB/s (8.17×) | 150 MB/s (6.18×) | 24.2 MB/s (baseline) |
| `large.md` (`gfm-spec.md`, 211 KB) |       **530 MB/s (16.4×)** |  338 MB/s (10.5×) | 191 MB/s (5.90×) | 150 MB/s (4.64×) | 32.3 MB/s (baseline) |

> Measured on 2026-08-20 with Node.js 24.19.0 on a 14-core Apple M4 Pro with 48
> GB RAM (macOS arm64).

## Payload size

What this machine loads in order to render, not the full npm tarball.

| Tool              |    Size | Contents                                              |
| ----------------- | ------: | ----------------------------------------------------- |
| @pierre/markdowns | 62.2 KB | 58.0 KB Wasm (34.6 KB gzipped) and 4.12 KB of JS glue |
| markdown-it       |  261 KB | 115 KB ESM plus 146 KB of runtime deps                |
| md4x (native)     |  376 KB | 372 KB N-API addon and 3.92 KB of JS                  |
| md4x (wasm)       |  379 KB | 368 KB Wasm and 10.9 KB of JS glue                    |

## Method

Each library is warmed for 250 ms, then timed in batches large enough that one
sample is at least 1.5 ms, for 1.5 seconds. The reported time is the median per
call. Throughput is input bytes per second using decimal MB (1e6). The result of
every call is consumed so the engine cannot dead-code the render.

The inputs are the checked-in [`tiny.md`](./fixtures/tiny.md),
[`simd.md`](./fixtures/simd.md), and [`gfm-spec.md`](./fixtures/gfm-spec.md)
fixtures. The large input is also used for the chart.

`@pierre/markdowns` and both md4x builds parse GFM. markdown-it is CommonMark
plus `linkify` (without fuzzy links), which is the closest it gets without extra
plugins: tables, strikethrough, and task lists stay as text. Output markup
differs slightly, so treat the comparison as indicative rather than exact.
