# Current benchmark results — October 23, 2026

These measurements predate the rename from `@pierre/markdowns` to
`@pierre/words`. Historical reports and raw results retain their original names
and captured paths; reproduction commands below use the current package name.

The current library leads Streamdown on the tested large-message workloads,
while both remain responsive on the small fixture. At 100×, Pierre has zero long
tasks across all configurations. The 1,000× cases still stutter heavily. There
is also a confirmed tradeoff: mixed highlighted updates are slower in the
current build than in the preceding HTML-addition build.

This report reruns browser responsiveness, parser speed, configured footprint,
and browser/formatter-session memory after the mutable-fence change. No library
implementation changed during these measurements. See the
[archived October 22 report](./OCTOBER-22.md) and
[raw results and build identities](./results/2026-10-23-current.json).

## Production browser responsiveness

Measurements ran serially on an Apple M4 Max with 16 logical CPUs and 128 GiB
RAM, macOS arm64, Node 24.11.0, and headless Chrome 156. Both renderers use
production React 19.2.7. The isolated comparator is Streamdown 2.7.1 with
`@streamdown/code` 2.0.0. Both matched the registry's latest published versions
when checked on October 23, 2026.

Each cell is the median of three fresh-browser runs. All 36 standard replays
delivered 267 updates, matched normalized paragraph/code text, and reported no
runtime errors. Highlighted modes rendered every expected fence; settled outputs
retained no fade wrappers.

| 1× / 8.5 KB         | Pierre update p95 | Streamdown update p95 | Frame p95, both |
| ------------------- | ----------------: | --------------------: | --------------: |
| Plain               |            1.1 ms |                3.4 ms |    16.7–16.8 ms |
| Highlighted         |            1.4 ms |                3.2 ms |         16.7 ms |
| Highlighted + fades |            1.1 ms |                2.9 ms |         16.8 ms |

All small runs had zero long tasks. Their update-time differences do not imply a
visible frame-rate advantage: both remain near a 60 Hz frame interval.

| 100× / 0.85 MB      | Pierre update p95 | Streamdown update p95 | Pierre frame p95 | Streamdown frame p95 |
| ------------------- | ----------------: | --------------------: | ---------------: | -------------------: |
| Plain               |            1.5 ms |               22.1 ms |          16.7 ms |              16.8 ms |
| Highlighted         |            4.1 ms |               21.6 ms |          16.7 ms |              16.8 ms |
| Highlighted + fades |            2.9 ms |               33.6 ms |          16.8 ms |              66.7 ms |

| 100× configuration  | Pierre settled replay | Streamdown settled replay | Pierre long tasks | Streamdown long tasks |
| ------------------- | --------------------: | ------------------------: | ----------------: | --------------------: |
| Plain               |               11.71 s |                   16.36 s |                 0 |                     1 |
| Highlighted         |               12.07 s |                   16.34 s |                 0 |                     2 |
| Highlighted + fades |               13.45 s |                   28.00 s |                 0 |                   106 |

All 18 Pierre standard runs had zero long tasks. Streamdown's 100× task counts
were 0/1/1 for plain output, 2/2/2 with highlighting, and 108/106/102 with
fades.

The 5.3–14.7× ratios compare p95 source-update latency, not total replay speed.
The producer waits 40 ms between committed deliveries. Replay elapsed therefore
includes pacing, rendering, and final settlement rather than measuring pure CPU
throughput.

### Matched settings and native differences

Both libraries use streaming mode and their own incremental paths. Pierre
retains completed HTML, consumes HTML additions, and updates the unfinished
suffix; its live highlighter can provide changed code lines. Streamdown keeps
its native block memoization, incomplete-markdown repair, and highlight cache.

Both receive the same fixture and 1280×960 viewport, with controls and line
numbers disabled. Source sizes are 8,524 / 852,598 / 8,525,998 ASCII characters;
chunks are 32 / 3,200 / 32,000 characters. Larger cases increase delivery size
as well as accumulated content, so this is not a fixed token-rate simulation.

Distinct warmup content initializes grammar and lazy modules before mounting an
empty renderer. Startup, downloads, and first grammar loading are excluded. The
fixture repeats identical TypeScript fences, allowing Streamdown's global code
cache to reuse results; unique programs and multiple languages may differ. Code
fonts/layout are normalized and maximum code height is disabled. Native
Streamdown code `content-visibility: auto` is preserved. Pierre has no active
containment policy; both viewports stay at the document top without following.

Both fades last 180 ms. Pierre animates delivered text chunks, including code;
Streamdown animates prose words with zero stagger and skips code. These rows
compare configured native behaviors rather than identical animation units.
Update time spans the source-change request through the parent layout effect,
excluding subsequent paint and passive effects. Frames cover playback; long
tasks also cover highlight/fade settlement. Primary timings exclude tracing and
DOM sampling. Normalized text parity does not establish identical DOM or layout.

### 1,000× / 8.53 MB capacity diagnostic

These are single runs, not medians. Completed outputs contain 101,000 paragraphs
and 1,000 highlighted fences and have matching normalized text hashes.

| Completed stress run        | Update p95 | Frame p95 | Settled replay | Long tasks | Final elements |
| --------------------------- | ---------: | --------: | -------------: | ---------: | -------------: |
| Pierre, highlighted         |    20.3 ms |  100.0 ms |        25.24 s |        155 |        889,281 |
| Streamdown, highlighted     |   173.0 ms |  216.6 ms |        56.60 s |        406 |        949,001 |
| Pierre, highlighted + fades |   169.0 ms |  183.3 ms |        81.92 s |        551 |        889,281 |

Streamdown's animated run exceeded the 180-second playback limit after 185 of
267 updates. Its partial percentiles and incomplete output are not included as
completed measurements. Pierre completes, but its 183 ms animated p95 frame
interval remains severe jank. Faster parsing does not remove accumulated browser
layout, paint, and animation costs at nearly a million elements.

## Controlled mixed-document regression

A separate check replayed the frozen, final guarded HTML-addition build against
the current build using the same current driver and byte-identical CSS. No
containment or scrolling was enabled. Both produced identical element counts,
normalized content, expected highlighted fences, and zero retained fade spans.

| Highlighted, fades off | Update p95 before | Update p95 current | Settled before | Settled current | Frame p95 before/current |
| ---------------------- | ----------------: | -----------------: | -------------: | --------------: | -----------------------: |
| 100×, three-run median |            2.5 ms |             4.3 ms |        11.80 s |         12.10 s |           16.8 / 16.7 ms |
| 1,000×, single run     |            6.3 ms |            20.7 ms |        25.41 s |         26.02 s |         116.6 / 116.6 ms |

The 100× tail update latency is 72% higher, while paced replay is about 2.5%
longer and both builds have zero long tasks. At 1,000×, the slower update tail
coexists with unchanged frame p95 and about 2.4% longer replay; long-task counts
were 168 before and 151 current. That single pair is diagnostic evidence, not a
repeated estimate. The recent fence path has a workload-specific cost worth
investigating; the long-fence win should not be described as a universal
speedup.

## Parser speed and parser-session memory

These results isolate HTML parsing/session output. They exclude formatting
hooks, highlighting, React, DOM, layout, and paint and are not a parser speed
ratio against Streamdown's complete renderer. Five timed replays follow one
untimed replay, alternating full/incremental order. Every sampled prefix matches
a fresh parse outside timing.

| HTML-string workload                    | 1× / 8.5 KB | 100× / 0.85 MB | 1,000× / 8.53 MB |
| --------------------------------------- | ----------: | -------------: | ---------------: |
| Complete document, median call          |    0.047 ms |        4.35 ms |         44.22 ms |
| Full reparse, 267 updates total         |     6.61 ms |      596.40 ms |      6,017.39 ms |
| Incremental session, 267 updates total  |     0.93 ms |       52.70 ms |        514.04 ms |
| Full/incremental work ratio             |        7.1× |          11.3× |            11.7× |
| Retained session JS heap increase       |    0.021 MB |       1.285 MB |        12.701 MB |
| Final HTML characters                   |      12,666 |      1,266,600 |       12,666,000 |
| Fresh append Wasm arena high-water mark |     128 KiB |        128 KiB |          192 KiB |

Memory uses a separate replay with source already present at baseline and a
fresh shared arena. Releasing the caller's result leaves session-cached HTML;
releasing the session returns reported JS heap near baseline. Full 1,000× static
rendering raises arena commitment to 24.5 MiB. A separate sparse 16-delivery
append uses 1.625 MiB: commitment depends on mutable chunk size. The shared
arena does not shrink on session release. JS heap, Wasm commitment, external
memory, and process RSS are separate or overlapping counters, not additive
totals.

Completed-block reuse has limits. A single open 18,000-character paragraph took
12.80 ms for full replay versus 13.88 ms incrementally; an open 18,014-character
fence took 6.59 versus 7.64 ms. Reference-definition fallback took 3.36 versus
3.58 ms. All sampled prefixes matched fresh parsing. The separate 64-character
streaming microbenchmark measured 11.36× less work for completed HTML blocks and
5.06× less work for its TypeScript highlighting replay, not browser rendering.

| Warmed static throughput | Pierre string → HTML | Pierre bytes → borrowed HTML | markdown-it |
| ------------------------ | -------------------: | ---------------------------: | ----------: |
| Tiny / 1.33 KB           |             269 MB/s |                     366 MB/s |   15.7 MB/s |
| Small / 39.0 KB          |             320 MB/s |                     566 MB/s |   25.2 MB/s |
| Large / 211 KB           |             299 MB/s |                     518 MB/s |   34.1 MB/s |

The borrowed bytes view is invalidated by the next render and avoids owned
string conversion; it is a different API contract. Parser coverage and the
markdown-it methodology remain described in [the benchmark README](./README.md).

## Mutable-fence formatter memory

New Node diagnostics compare three warmed sessions per configuration against the
saved pre-fence-change formatter. Source strings are flattened before the
baseline. Each stage follows two explicit GCs; DOM and performance timers are
absent. The measured contract consumes changed code HTML when available.

| Additional active JS heap |   Before |  Current |
| ------------------------- | -------: | -------: |
| 1,000 lines, numbers on   |  1.47 MB |  1.15 MB |
| 1,000 lines, numbers off  |  1.48 MB |  1.07 MB |
| 10,000 lines, numbers on  | 14.23 MB | 10.86 MB |
| 10,000 lines, numbers off | 14.21 MB | 10.29 MB |

For 10,000 lines with numbers, active additional heap is about 24% lower. After
closing the fence, both retain about 4.6 MB above baseline; empty reset and
release return near baseline. These are formatter-session JS heap samples in one
warmed Node process, not total RAM, browser memory, or peak allocation.

[FENCES.md](./FENCES.md) records the earlier same-library long-fence timing
comparison: 10,000-line p95 update time fell from 122.5 to 18.5 ms with line
numbers. Those browser timing tests were not rerun in this phase and should not
be mixed into the fresh Streamdown matrix. Only fence memory was newly sampled.

## Browser memory

Values are medians of three fresh-browser samples per provider/configuration.
Baseline, settled output, and keyed empty reset each follow two explicit GCs.
Additional heap and reset deltas are computed within each sample first. All 12
samples completed with no runtime errors, pending highlights, or settled fades.

| 100× reported JS heap | Pierre highlighted | Streamdown highlighted | Pierre fades | Streamdown fades |
| --------------------- | -----------------: | ---------------------: | -----------: | ---------------: |
| Warmed empty baseline |            3.08 MB |                9.18 MB |      3.08 MB |          9.18 MB |
| Settled output        |            9.16 MB |              140.44 MB |     11.11 MB |        232.45 MB |
| Additional heap       |            6.08 MB |              131.25 MB |      8.03 MB |        223.27 MB |
| Empty reset           |            5.35 MB |               26.31 MB |      6.73 MB |         28.22 MB |
| Reset above baseline  |            2.27 MB |               17.13 MB |      3.65 MB |         19.04 MB |

Additional reported heap is about 21.6× lower with highlighting and 27.8× lower
with fades in this fixture. Pierre's fades are associated with about 2 MB more
settled JS heap. Median sampled peak fade-wrapper counts are 1,992 for Pierre
and 107,897 for Streamdown; all samples finish with zero wrappers.

These diagnostics run separately from primary timings, with explicit GC and
once-per-second active DOM sampling. Reported JS heap excludes complete native
DOM, Wasm, graphics, and total process memory. Sampled wrapper peaks can miss
the true peak, and reset deltas alone do not establish a leak.

## Configured transfer footprint

Same esbuild 0.27.4, minified ES2022 browser ESM, React/React DOM external, gzip
level 9 per file. This is consumer transfer size, not runtime memory or startup.

| Configured entry                                   | Pierre gzip | Streamdown gzip |
| -------------------------------------------------- | ----------: | --------------: |
| Framework-independent HTML renderer                |    49,175 B |               — |
| Base React renderer, initial load                  |    49,685 B |       158,047 B |
| Renderer + TypeScript + two themes, loaded closure |   170,669 B |       239,413 B |
| Library CSS, separate                              |     1,011 B |           447 B |

The base initial entry is about 69% smaller and the configured highlighted
closure about 29% smaller. Streamdown's base lazy closure adds 384 gzip bytes.
Compared with October 22, Pierre's base entry grows by 1,256 gzip bytes and its
highlighted closure by 1,477 bytes. Its highlighted closure includes TypeScript,
GitHub Light/Dark, and lazy code body chunks; Pierre uses Pierre Light/Dark and
ships its grammar set together. Other Streamdown languages/plugins and
application Tailwind utility CSS are excluded. Different grammar/plugin coverage
limits broad bundle-size claims.

## Remaining investigation

Investigate the measured mixed-document update regression alongside the
long-fence gain, then profile remaining accumulated DOM/rendering costs at
1,000×. Add unique-code, multiple-language, and smaller-delivery workloads
before generalizing these repeated-fixture results.

## Reproduction

Use the isolated dependency directory recorded in the raw report. The main
browser matrix uses `bench-render-compare` with
`--scales=1,100 --runs=3 --scroll=top --containment=none`; the bounded stress
diagnostic uses `--scales=1000 --modes=highlight,animated --runs=1`. Each writes
its own output directory. Serve prepared bundles with
`--skip-build --serve-only`, then run `bench-memory` separately for
`highlight 100 3` and `animated 100 3`.

```sh
moon run words:bench
moon run words:bench-stream
moon run words:bench-html -- /tmp/current-parser.json
moon run words:bench-large -- 1000 16 /tmp/current-large.json
moon run words:bench-footprint -- /tmp/markdowns-streamdown-setup-20261021/node_modules /tmp/current-footprint
moon run words:bench-fence -- --deps=/tmp/markdowns-streamdown-setup-20261021/node_modules --output=/tmp/current-fence-memory --phases=memory --memory-runs=3
```

The fence memory phase materializes source before baseline and discards a full
warmup replay. Its three sessions per case share one warmed process; reported
heap excludes external allocations and Wasm commitment as well as native DOM.
