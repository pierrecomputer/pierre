# Benchmark results — October 22, 2026

This is the archived report. See [CURRENT.md](./CURRENT.md) for the subsequent
full rerun.

For the subsequent mutable code fence optimization, see
[FENCES.md](./FENCES.md). For the subsequent non-animated HTML-addition
optimization and containment experiments, see
[NON-ANIMATED.md](./NON-ANIMATED.md). The comprehensive tables below describe
the earlier build and its Streamdown comparison.

The current HTML-first library leads Streamdown on the tested large-message
workloads. At 100×, its p95 update latency is 4.4–7.4× lower, with zero long
tasks in every run. Both libraries remain responsive on the small fixture. At
1,000×, both become visibly janky; our animated case completes, but is not
smooth.

This is a fresh rerun after removing the unused tree APIs, consolidating fade
bookkeeping, and reusing initial HTML formatting. No library implementation
changed during measurement.
[Raw results, environment, and build hashes](./results/2026-10-22-current.json)
identify the uncommitted build measured here. Earlier reports remain historical;
these tables supersede their current-state measurements.

## Production browser responsiveness

Measurements ran serially on an Apple M4 Max with 16 logical CPUs and 128 GiB
RAM, macOS 26.6.2 arm64, Node 24.11.0, and headless Chrome 156. Both renderers
use production React 19.2.7. Streamdown 2.7.1 and `@streamdown/code` 2.0.0 were
checked against the registry's latest versions on October 22, 2026.

Each cell below is the median of three fresh-browser runs. The standard matrix
contains 36 completed replays. All delivered 267 updates, matched normalized
paragraph/code text, and reported no runtime errors. Highlighted modes rendered
all expected code fences; settled outputs retained no fade wrappers.

| 1× / 8.5 KB         | Pierre update p95 | Streamdown update p95 | Pierre frame p95 | Streamdown frame p95 |
| ------------------- | ----------------: | --------------------: | ---------------: | -------------------: |
| Plain               |            1.1 ms |                3.1 ms |          16.7 ms |              16.7 ms |
| Highlighted         |            2.6 ms |                3.4 ms |          16.7 ms |              16.7 ms |
| Highlighted + fades |            2.2 ms |                3.6 ms |          16.7 ms |              16.7 ms |

All small runs had zero long tasks. Update differences at this size do not
translate into a visible frame-rate advantage: both sustain approximately 60 Hz
in this harness.

| 100× / 0.85 MB      | Pierre update p95 | Streamdown update p95 | Pierre frame p95 | Streamdown frame p95 |
| ------------------- | ----------------: | --------------------: | ---------------: | -------------------: |
| Plain               |            3.1 ms |               21.8 ms |          16.7 ms |              16.7 ms |
| Highlighted         |            4.9 ms |               21.4 ms |          16.7 ms |              16.8 ms |
| Highlighted + fades |            4.4 ms |               32.5 ms |          16.8 ms |              66.7 ms |

| 100× configuration  | Pierre settled replay | Streamdown settled replay | Pierre long tasks | Streamdown long tasks |
| ------------------- | --------------------: | ------------------------: | ----------------: | --------------------: |
| Plain               |               12.32 s |                   16.28 s |                 0 |                     0 |
| Highlighted         |               12.67 s |                   16.37 s |                 0 |                     2 |
| Highlighted + fades |               13.87 s |                   27.68 s |                 0 |                   112 |

All 18 Pierre standard runs had zero long tasks. Streamdown's 100× counts were 0
/ 0 / 1 for plain output, 2 / 2 / 2 with highlighting, and 100 / 112 / 114 with
fades. Long tasks block the browser's main thread for more than 50 ms.

The 4.4–7.4× ratios compare p95 update latency, not total replay speed. The
producer deliberately waits 40 ms between committed deliveries, so replay
elapsed time includes pacing, browser rendering, and final settlement.

### What is matched, and what differs

Both libraries run in streaming mode with their own incremental paths enabled.
Pierre retains completed HTML and reparses the unfinished suffix. Streamdown
retains its native block memoization and highlighting cache; this is not a
comparison against full-document React reconstruction on every update.
[Streamdown documents its memoization strategy here](https://streamdown.ai/docs/memoization).
The adapters are in [compare-browser.mjs](./compare-browser.mjs).

The same fixture, 1280×960 viewport, disabled controls/line numbers, and 267
deliveries apply to both. Fixture sizes are 8,524 / 852,598 / 8,525,998 ASCII
characters, with chunks of 32 / 3,200 / 32,000 characters. Larger cases
therefore increase delivery size as well as accumulated content; they are not a
fixed token-rate simulation.

Highlighters are warmed on distinct content before an empty renderer is mounted.
Cold downloads, module startup, and first grammar initialization are excluded.
The repeated TypeScript fences can reuse Streamdown's native highlight cache;
the fixture does not establish performance on many unique programs or languages.
Streamdown's native code `content-visibility: auto` is preserved; Pierre does
not enable it. These runs keep the viewport at the document top and do not
measure scrolling or following the streaming cursor.

Both fades use 180 ms duration, but their units differ. Pierre animates
delivered text chunks, including code. Streamdown animates prose words with zero
stagger and skips code, following its
[native animation behavior](https://streamdown.ai/docs/animation). The animated
rows compare those configured behaviors, not identical DOM or visual effects.

Update time runs from requesting the source change to the parent layout effect;
it excludes following paint and passive effects. Frame intervals are sampled
during playback. Long tasks include playback and highlight/fade settlement.
Tracing and DOM sampling are disabled in these primary timing runs.

### 1,000× / 8.53 MB stress diagnostic

These are single runs, not repeated medians. The completed outputs contain
101,000 paragraphs and 1,000 highlighted fences and share the same normalized
text hash.

| Completed stress run        | Update p95 | Frame p95 | Settled replay | Long tasks | Final elements |
| --------------------------- | ---------: | --------: | -------------: | ---------: | -------------: |
| Pierre, highlighted         |    29.9 ms |  116.7 ms |        33.80 s |        176 |        889,281 |
| Streamdown, highlighted     |   178.1 ms |  216.7 ms |        56.21 s |        401 |        949,001 |
| Pierre, highlighted + fades |   202.7 ms |  216.6 ms |        91.24 s |        637 |        889,281 |

**Streamdown's 1,000× animated run failed the 180-second playback limit after
185 of 267 updates.** It has no completed-run percentiles or settled time in the
table. Its partial measurements are retained only in the raw diagnostic.

Our non-animated path has substantially less update work in this test, but 116.7
ms frame intervals still mean severe jank. Fades increase our own update cost
and long-task count substantially at this scale. Faster parsing has not removed
the cost of a live DOM approaching a million elements.

## Parser speed and memory

These measurements isolate our HTML parser and session API. They exclude
highlighting, formatting hooks, React, DOM, layout, and paint, and do not
compare against Streamdown's complete rendering pipeline. Five timed replays
follow an untimed replay, alternating full/incremental order. Every sampled
prefix matches a fresh HTML parse outside the timing section.

| HTML-string workload                    | 1× / 8.5 KB | 100× / 0.85 MB | 1,000× / 8.53 MB |
| --------------------------------------- | ----------: | -------------: | ---------------: |
| Complete document, median call          |    0.045 ms |        4.33 ms |         44.41 ms |
| Full reparse, 267 updates total         |     6.58 ms |      584.78 ms |      5,942.43 ms |
| Incremental session, 267 updates total  |     0.86 ms |       50.55 ms |        510.48 ms |
| Full/incremental work ratio             |        7.7× |          11.6× |            11.6× |
| Retained session JS heap increase       |    0.021 MB |       1.283 MB |        12.701 MB |
| Final HTML characters                   |      12,666 |      1,266,600 |       12,666,000 |
| Fresh append Wasm arena high-water mark |     128 KiB |        128 KiB |          192 KiB |

Memory uses a separate replay, a fresh shared arena, and two explicit GCs per
sample. The source is already in the baseline. Releasing the caller result
leaves the session's cached HTML strings retained; releasing the session returns
reported JS heap close to baseline. HTML output still occupies space
proportional to document size.

The arena size is a commitment high-water mark, not occupied parser data. A full
1,000× static render raises it to **24.5 MiB**, versus **192 KiB** for the
267-delivery fresh append replay above. Sparse 16-delivery append testing uses
1.625 MiB at 1,000×: the required arena depends on mutable chunk size. Releasing
output or a session does not shrink the shared arena. Benchmark arena
replacement isolates samples; it is not a public trimming API. JS heap, Wasm
commitment, external memory, and process RSS are distinct or overlapping
counters and must not be added into a purported total.

Completed-block reuse cannot help equally with every input:

| 64-character delivery workload          | Full replay | Incremental replay |
| --------------------------------------- | ----------: | -----------------: |
| One open paragraph, 18,000 characters   |    13.16 ms |           15.65 ms |
| One open code fence, 18,014 characters  |     6.85 ms |            7.93 ms |
| Reference definitions, 8,539 characters |     5.26 ms |            5.08 ms |

The mutable paragraph and code fence are slower with session overhead here;
reference definitions deliberately retain a correctness fallback. All sampled
prefixes match full parsing. The separate streaming microbenchmark reports
11.79× less parser work on completed HTML blocks but only 1.18× less work on its
long TypeScript highlighting replay. These ratios are workload-specific.

The warmed static parser throughput rerun also remains strong:

| Input            | Pierre string → HTML | Pierre bytes → borrowed HTML | markdown-it |
| ---------------- | -------------------: | ---------------------------: | ----------: |
| Tiny / 1.33 KiB  |             261 MB/s |                     358 MB/s |   15.6 MB/s |
| Small / 39.0 KiB |             313 MB/s |                     553 MB/s |   24.4 MB/s |
| Large / 211 KiB  |             291 MB/s |                     512 MB/s |   33.1 MB/s |

The bytes API returns a view invalidated by the next render. It avoids the owned
output-string conversion and is not equivalent to the string API. These
parser-only numbers are not a speed ratio against Streamdown. Parser coverage
and methodology differences with markdown-it remain as described in the
[benchmark README](./README.md).

## Browser memory

Browser memory is sampled separately from timing, in fresh warmed browsers, with
two explicit GCs at baseline, settled output, and keyed empty reset. Active DOM
sampling runs only during these diagnostics; their timings are excluded from the
responsiveness tables.

Values below are medians of three fresh-browser samples per library and
configuration, in decimal MB. Additional heap and reset deltas are calculated
within each sample before taking the median. All 12 samples completed without
errors or pending highlights.

| 100× reported JS heap | Pierre, highlighted | Streamdown, highlighted | Pierre, with fades | Streamdown, with fades |
| --------------------- | ------------------: | ----------------------: | -----------------: | ---------------------: |
| Warmed empty baseline |             3.06 MB |                 9.18 MB |            3.06 MB |                9.18 MB |
| Settled output        |             9.45 MB |               140.43 MB |           11.45 MB |              231.72 MB |
| Additional heap       |             6.39 MB |               131.25 MB |            8.39 MB |              222.54 MB |
| Empty reset           |             4.35 MB |                26.27 MB |            4.44 MB |               28.21 MB |
| Reset above baseline  |             1.29 MB |                17.10 MB |            1.38 MB |               19.03 MB |

The additional heap is about 20.6× lower with highlighting and 26.5× lower with
fades in this workload. Enabling fades is associated with about 2.0 MB more
settled heap for Pierre. These are retained-heap comparisons after GC, not peak
allocation or total RAM measurements.

The median sampled peak fade-wrapper count was 1,960 for Pierre and 109,121 for
Streamdown. All samples ended with zero fade wrappers. These once-per-second
counts indicate bounded active wrappers in Pierre, but may miss the true peak;
they are structural observations rather than byte estimates.

Chromium's `performance.memory.usedJSHeapSize` is reported JavaScript heap. It
excludes complete native DOM, Wasm, graphics, and total process memory. DOM node
counts describe structure rather than bytes. A reset delta can include shared
caches and runtime state and does not establish a leak by itself.

## Configured transfer footprint

Same esbuild 0.27.4, minified ES2022 browser ESM, React and React DOM external,
gzip level 9 per output file. These are consumer bundle sizes, not npm tarball
size, cold-start latency, or runtime memory.

| Configured entry                                   | Pierre gzip | Streamdown gzip |
| -------------------------------------------------- | ----------: | --------------: |
| Framework-independent HTML renderer                |    47,917 B |               — |
| Base React renderer, initial load                  |    48,429 B |       158,047 B |
| Renderer + TypeScript + two themes, loaded closure |   169,192 B |       239,413 B |
| Library CSS, separate                              |     1,011 B |           447 B |

The base initial payload is 69% smaller; the configured highlighted closure is
29% smaller. Streamdown's base lazy closure adds 384 gzip bytes beyond its
initial entry. Its application-specific Tailwind utility CSS is excluded. The
highlighted closure includes the TypeScript grammar, default GitHub Light/Dark
themes and highlighted-body lazy chunks for Streamdown, and Pierre Light/Dark
for Pierre. Other optional plugins/languages are excluded from that closure.
Pierre currently ships its grammar set together, while Streamdown loads
individual grammars lazily. These configurations have different language and
plugin coverage.

## Remaining work

1. **Limit browser work on very large completed content.** The 1,000× cases
   establish a remaining DOM/layout/animation capacity problem. Prototype
   containment or visibility policies and measure their effect before adopting
   them. Streamdown's native code visibility optimization alone does not make
   this fixture smooth.
2. **Measure long mutable fences separately.** The live tokenizer reuses
   unchanged line output, but the Markdown highlighter adapter still rejoins the
   whole highlighted fence on every update. The HTML formatter also processes
   the pending fence again. A line-range or append-oriented HTML path is a
   candidate; the current microbenchmark does not prove it is the main browser
   bottleneck. See [the highlighting adapter](../react/highlights.ts) and
   [HTML formatter](../html/render.ts).
3. **Keep correctness fallbacks visible.** A long unfinished paragraph/fence
   cannot reuse completed-block HTML, and reference definitions can invalidate
   earlier output. Any additional checkpoint strategy must preserve full-parse
   parity. See [the HTML session](../lib/index.mjs).
4. **Consider optional grammar loading if transfer size matters.** Splitting
   Pierre's grammar set could reduce initial highlighted payload for
   applications using few languages. This is a packaging tradeoff to measure
   alongside cold startup and cache behavior, not a demonstrated fix for frame
   jank.

## Reproduce

Use the isolated competitor dependencies pinned in the raw report, outside the
workspace dependency graph:

```sh
moon run markdowns:bench
moon run markdowns:bench-stream
moon run markdowns:bench-html -- /tmp/current-parser.json
moon run markdowns:bench-large -- 100 16 /tmp/current-large-100.json
moon run markdowns:bench-large -- 1000 16 /tmp/current-large-1000.json
moon run markdowns:bench-footprint -- /tmp/markdowns-streamdown-setup-20261021/node_modules /tmp/current-footprint
moon run markdowns:bench-render-compare -- --deps=/tmp/markdowns-streamdown-setup-20261021/node_modules --output=/tmp/current-browser --scales=1,100 --runs=3
moon run markdowns:bench-render-compare -- --deps=/tmp/markdowns-streamdown-setup-20261021/node_modules --output=/tmp/current-stress --scales=1000 --modes=highlight,animated --runs=1
```

For separate browser memory, serve prepared bundles using
`bench-render-compare --skip-build --serve-only` and use its printed URL:

```sh
moon run markdowns:bench-memory -- http://127.0.0.1:PORT /tmp/current-heap-highlight.json highlight 100 3
moon run markdowns:bench-memory -- http://127.0.0.1:PORT /tmp/current-heap-animated.json animated 100 3
```
