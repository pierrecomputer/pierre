# Words benchmarks

## Reproduce from a fresh clone

Use the toolchain in the repository's `.prototools` and follow
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md) to install the monorepo
dependencies. Then run these commands from anywhere in the repository:

```sh
moon run words:bench-setup
moon run words:bench-quick
moon run words:bench-full
```

Build-connected benchmark tasks deliberately skip automatic CI. In a CI-marked
shell, request them explicitly with `moonx words:bench-quick --ignore-ci-checks`
or `moonx words:bench-full --ignore-ci-checks`. Setup, report, and chart tasks
run without that override.

`bench-setup` installs the separate frozen pnpm lockfile in
[`harness`](./harness/package.json) and downloads **Chrome 156.0.8078.47**.
Streamdown **2.7.1**, `@streamdown/code` **2.0.0**, React/React DOM **19.2.7**,
esbuild **0.27.4**, and agent-browser **0.33.1** are pinned in the harness's own
catalog. The harness is an intentional standalone workspace: these tools are
benchmark dependencies and never become Words runtime dependencies. No global
browser CLI or manually prepared dependency directory is required.

The supported browser downloads are Chrome for Testing on macOS and Linux x64
(and other platforms supported by `@puppeteer/browsers`). Linux needs Chrome's
usual system libraries. If your platform has no download, or you already have
Chrome installed, skip the download and supply its executable explicitly:

```sh
moon run words:bench-setup -- --skip-browser
WORDS_BENCH_BROWSER=/absolute/path/to/chrome moon run words:bench-quick
```

The override's path and actual version are recorded; a different Chrome build is
a different test environment. Setup and runs fail with actionable errors when
tools or the selected executable are missing.

- **Quick** checks static parsing, a 1× HTML replay, incremental parser and
  highlighter replay, bundle footprint, and one fresh-browser run per renderer
  for plain and highlighted 1× output. It takes about a minute here. Its shorter
  static timing budget and single browser samples are a harness check, not
  publication evidence.
- **Full** uses the normal static timing budget, HTML replays at 1×/100×/1,000×,
  and three fresh-browser runs per renderer at 1×/100× in plain, highlighted,
  and highlighted-with-fades modes. It then measures each mode's 100× heap in
  separate fresh browsers with explicit GC. Allow roughly 10–20 minutes,
  depending on the machine.
- **Capacity** adds bounded single-run 1,000× browser diagnostics. These can
  stutter or time out; partial output stays a failure row and is never included
  in completed timing aggregates.

```sh
moon run words:bench-full -- --stress
moon run words:bench-full -- --scales=1 --modes=highlight --runs=1
moon run words:bench-full -- --skip-memory
moon run words:bench-full -- --phases=memory --modes=highlight --runs=1
```

The reduced matrix is useful for validating the full pipeline. Heap sampling
still uses 100× output; `--scales` selects browser timing scales. `--stress`
adds the separate 1,000× capacity phase. `--phases` selects individual phases
for diagnosis; a memory-only run prepares its own bundles and server. Partial
phase runs record their selected coverage and do not represent the full suite.
Run measurements serially on an idle machine, on power, with the same browser
and build settings; avoid running a docs build or another benchmark alongside
them.

## Outputs and published charts

Every run creates a new gitignored `benchmark/output/<UTC>-quick|full/`
directory. Use `--output=/absolute/path/to/a-new-directory` to choose a
different location; a directory with an existing run manifest is rejected. The
harness starts and stops its own local server and closes each private browser
session. It does not need the docs dev server.

The run directory contains:

- `report.json`: a consolidated `words-benchmark-run` schema v1 containing the
  original phase outputs and a SHA-256/byte-size index of their files. It
  preserves the run's success/failure status and partial evidence. Regenerate
  from existing outputs with `moon run words:bench-report -- /path/to/run`.
- `manifest.json`: success/failure, exact phase commands, Node/OS/CPU/RAM,
  browser executable/version, Git commit and dirty state, toolchain and lockfile
  hashes, fixture/driver hashes, and built-file hashes.
- `parser-static.json`, `parser.json`, and `stream.json`: complete per-sample
  parser results, parity checks, session memory, and incremental replay results.
- `browser/summary.json`: every fresh-browser result, including actual browser
  user agent, update/frame percentiles, long tasks, and normalized text checks.
- `footprint/summary.json`: raw/gzip sizes and the configured lazy-load closure.
- `memory-<mode>.json` on full runs: baseline, settled, reset, and active DOM
  samples for each fresh browser. Each phase also retains a text log.
- `stress/summary.json` with `--stress`: completed or bounded-failure capacity
  diagnostics, kept separate from the standard matrix.

A standard run is marked failed if a phase errors, a browser sample is partial,
the expected matrix is incomplete, normalized renderer output differs, a fence
is not highlighted, or a memory sample has errors/pending work. The manifest
retains failed phases and prior completed evidence.

The public charts are generated from a reviewed **historical snapshot**,
[`results/2026-10-23-current.json`](./results/2026-10-23-current.json), rather
than silently replaced by a local run. This snapshot predates the Words rename.
Regenerate/check the public evidence with:

```sh
moon run words:bench-chart
moon run words:bench-chart-check
moon run words:bench-chart-test
```

[`chart-data.mjs`](./chart-data.mjs) validates the captured evidence and writes
the public summary plus a byte-identical raw download. To inspect another
consolidated snapshot without publishing it, supply `--input`, `--output`, and
`--raw-output` paths. Fresh quick/full runs also write a consolidated
`report.json`; that schema is independent of the historical chart snapshot and
needs review/adaptation before promotion to the published snapshot format.
Historical raw results remain unchanged.

## What the measurements mean

The production browser comparison sends the same fixture and delivery sequence
to each renderer, using each library's native streaming path. It warms grammar
and lazy modules with different code, then mounts an empty renderer. Both use
production React, a 1280×960 viewport, 40 ms commit-paced delivery, disabled
code controls/line numbers, no following scroll, and no experimental
containment. Runs alternate which renderer is first. Primary timings exclude
tracing, DOM sampling, explicit GC, downloads, and cold startup.

Update p95 covers the source-change request through the parent layout effect; it
excludes subsequent paint and passive effects. Frame intervals represent
playback responsiveness. Settled elapsed time includes the producer's deliberate
40 ms waits and is not pure CPU throughput. Long tasks include settlement. The
harness verifies delivered updates, normalized paragraph/code text, expected
highlighted fences, and settled fade cleanup; DOM and styling need not match.

The fixture repeats the same TypeScript fence. A 1×/100×/1,000× scale changes
both accumulated content and characters per delivery (32/3,200/32,000), keeping
267 deliveries. This exercises large-document accumulation, not a fixed token
rate. Repeated fences benefit Streamdown's native global code cache. Unique
programs and multiple languages require separate workloads before broad claims.
Both fade durations are 180 ms; Words fades delivered chunks including code,
while Streamdown fades prose words with zero stagger and excludes code. These
are native configurations with different animation units.

Heap is reported JS heap after two GCs, not total RAM. It excludes complete
native DOM/graphics and Wasm accounting; Wasm capacity is reported separately
for parser sessions and does not shrink. Active wrapper sampling happens only in
the separate memory phase and can miss exact peaks. Reset retention is not proof
of a leak. Footprint is minified browser ESM with React external, gzip level 9
per file, and the configured TypeScript/theme closure; application Tailwind
utility CSS and additional Streamdown plugins/languages are excluded. Parser
throughput excludes highlighting, framework, DOM, layout, and paint.

## Individual diagnostics and archived evidence

The original tasks remain available for focused investigation:

```sh
moon run words:bench
moon run words:bench-stream -- --json=/absolute/path/stream.json
moon run words:bench-html -- /absolute/path/parser.json --scales=1,100
moon run words:bench-render-compare -- --output=/absolute/path/browser --scales=1,100 --runs=3
moon run words:bench-fence -- --output=/absolute/path/fence --phases=node,memory
```

The comparison and fence scripts default to the checked-in harness dependencies;
`--deps=/absolute/path/node_modules` is retained for deliberate alternate-tool
experiments. Those runs require checking their versions separately. Focused
`bench-render` profiles the actual production docs page and still takes its URL
explicitly; standard quick/full runs are self-contained.

### Archived static-parser results

These measurements predate the rename from `@pierre/markdowns` to
`@pierre/words`. Historical reports and raw results retain their original names
and captured paths; reproduction commands below use the current package name.

Throughput against [md4x](https://github.com/unjs/md4x) (MD4C, native and Wasm)
and [markdown-it](https://github.com/markdown-it/markdown-it).

The [mutable code fence follow-up](./FENCES.md) measures changed-line HTML and
DOM updates at 1,000 and 10,000 lines, including paced playback and remaining
browser rendering costs. Reproduce it with `bench-fence`.

The [non-animated large-document follow-up](./NON-ANIMATED.md) measures the
implemented HTML-addition optimization, offscreen rendering experiments, and the
demo's stream-following layout cost.

The [current benchmark report](./CURRENT.md) covers parser replay, browser
responsiveness, memory, and bundle footprint after HTML additions and mutable
fence updates, including a fresh Streamdown comparison, active-fence heap, the
mixed-document regression, and the 1,000× capacity limit. The preceding full
rerun is archived in [OCTOBER-22.md](./OCTOBER-22.md).

The [initial October 22 HTML-first report](./HTML-FIRST.md) records the rewrite
and the large-document fade regression resolved by removing custom selection
handling.

The [historical React-renderer and Streamdown comparison](./COMPARISON.md)
includes the October 21, 2026 parser rerun, matched browser replays, memory
diagnostics, and configured bundle sizes. It predates the HTML-first rendering
path.

HTML-first measurements use `bench-html` for string-output replay and memory,
`bench-render-compare` for production browser timings, `bench-memory` for
separate browser heap diagnostics, and `bench-footprint` for configured consumer
bundles. `bench-large` measures sparse HTML replays, borrowed/owned HTML output,
and session memory at the selected stress scale. Both streaming tasks now use
HTML strings; the earlier structured-element APIs have been removed.

```sh
moonx words:bench
moonx words:bench -- --chart   # write benchmark-{light,dark}.svg for the README
```

## Results

String in and HTML string out, except `bytes io`, which accepts a `Uint8Array`
and returns a view of Wasm memory. Higher is better. Parentheses are speedup
over markdown-it.

| Input                              | @pierre/words bytes io |    @pierre/words |      md4x native |        md4x wasm |          markdown-it |
| ---------------------------------- | ---------------------: | ---------------: | ---------------: | ---------------: | -------------------: |
| `tiny.md` (1.33 KB)                |   **358 MB/s (23.9×)** | 256 MB/s (17.1×) | 146 MB/s (9.77×) | 109 MB/s (7.28×) | 15.0 MB/s (baseline) |
| `small.md` (39.0 KB)               |   **561 MB/s (23.2×)** | 373 MB/s (15.4×) | 198 MB/s (8.17×) | 150 MB/s (6.18×) | 24.2 MB/s (baseline) |
| `large.md` (`gfm-spec.md`, 211 KB) |   **530 MB/s (16.4×)** | 338 MB/s (10.5×) | 191 MB/s (5.90×) | 150 MB/s (4.64×) | 32.3 MB/s (baseline) |

> Measured on 2026-08-20 with Node.js 24.19.0 on a 14-core Apple M4 Pro with 48
> GB RAM (macOS arm64).

## Payload size

What this machine loads in order to render, not the full npm tarball.

| Tool          |    Size | Contents                                              |
| ------------- | ------: | ----------------------------------------------------- |
| @pierre/words | 62.2 KB | 58.0 KB Wasm (34.6 KB gzipped) and 4.12 KB of JS glue |
| markdown-it   |  261 KB | 115 KB ESM plus 146 KB of runtime deps                |
| md4x (native) |  376 KB | 372 KB N-API addon and 3.92 KB of JS                  |
| md4x (wasm)   |  379 KB | 368 KB Wasm and 10.9 KB of JS glue                    |

## Method

Each library is warmed for 250 ms, then timed in batches large enough that one
sample is at least 1.5 ms, for 1.5 seconds. The reported time is the median per
call. Throughput is input bytes per second using decimal MB (1e6). The result of
every call is consumed so the engine cannot dead-code the render.

The inputs are the checked-in [`tiny.md`](./fixtures/tiny.md),
[`simd.md`](./fixtures/simd.md), and [`gfm-spec.md`](./fixtures/gfm-spec.md)
fixtures. The large input is also used for the chart.

The current static runner honors the full 250 ms warmup and records its actual
duration per result. The previous runner could stop after 80 calls, warming fast
engines for less time. Historical snapshots keep their original timings; the
browser, memory, and transfer charts use separate measurement paths.

`@pierre/words` and both md4x builds parse GFM. markdown-it uses its default
preset with tables, strikethrough, HTML, and `linkify` (fuzzy links disabled);
task-list checkboxes remain plain text. Output markup differs slightly, so treat
the comparison as indicative rather than exact.
