# Words benchmarks

## Local parser optimization

Use `words:lab` for parser optimization and hill-climbing. It needs the normal
workspace dependencies, but no competitor harness, browser download, or mitata.
It leaves production code and the published benchmark evidence unchanged. Run it
on an idle machine, on power, without concurrent builds or benchmarks.

```sh
moonx words:lab --ignore-ci-checks -- list
moonx words:lab --ignore-ci-checks -- quick
moonx words:lab --ignore-ci-checks -- capture --output=/tmp/words-before
# Make the optimization. The next command builds and captures the current code.
moonx words:lab --ignore-ci-checks -- quick --baseline=/tmp/words-before
moonx words:lab --ignore-ci-checks -- capture --output=/tmp/words-after
moonx words:lab --ignore-ci-checks -- confirm --baseline=/tmp/words-before --candidate=/tmp/words-after
```

Capture directories contain the optimized Wasm, JavaScript glue, WAT sources,
build-helper source, hashes, and environment metadata. Comparisons execute these
saved artifacts rather than switching the working tree. An omitted candidate
means the current build. Use a new output directory for each run; the runner
rejects overwritten results and modified captures. Relative paths resolve from
`packages/words`, where Moon runs the task. Default results live in gitignored
`benchmark/output/lab/`.

| Mode      | Defaults                                                                                                      | Use                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `quick`   | 75 ms warmup, 5 batches targeting at least 15 ms each; 1 process per case, or 4 process pairs with a baseline | Screen ideas; all verdicts remain exploratory            |
| `confirm` | 300 ms warmup, 9 batches targeting at least 30 ms each, 12 fresh process pairs                                | Estimate uncertainty for a selected change               |
| `profile` | 3 seconds of CPU sampling plus a separate instrumented replay                                                 | Find hot functions and repeated work; no speedup verdict |

### Select workloads and measurement boundaries

`list` prints case IDs, sizes, delivery counts, and timing boundaries. The eight
default cases cover a small real document, medium-document byte and string I/O,
and streaming blocks, long paragraphs, open fences, late definitions, and
Unicode. `--cases=all` adds the GFM specification, an approximately 850 KB
stress input, tables/lists, malformed input, repeated deliveries, edits, and
isolated kernels.

```sh
moonx words:lab --ignore-ci-checks -- quick --cases=all
moonx words:lab --ignore-ci-checks -- quick --baseline=/tmp/words-before --cases=kernel-render,static-string,stream-blocks-suffix
moonx words:lab --ignore-ci-checks -- quick --cases=stream-blocks-token,stream-blocks-suffix,stream-blocks-coarse
```

- `static-*`: one complete document. Byte-input cases include copying into Wasm;
  string-output cases also include decoding HTML. Borrowed output is consumed
  before the next render.
- `stream-*-full`: render every accumulated prefix from scratch, including
  incomplete-markdown completion and HTML decoding.
- `stream-*-suffix`: create a fresh session and replay the whole stream,
  consuming `addition` and `pending` without requesting full HTML.
  `stream-blocks-session` requests the session's full HTML on the same
  deliveries. These cases exclude network pacing, DOM, React, and highlighting.
- Most streams deliver 64 UTF-16 code units per update. The token/coarse cases
  deliver 8/1024 units of the same document. Unicode deliveries deliberately
  include split surrogate pairs. Byte counts and UTF-16 counts are separate.
- `kernel-encode`, `kernel-copy`, and `kernel-decode` isolate UTF-8 and
  input-copy costs using prepared buffers. `kernel-render` calls the production
  render export over preloaded input. `kernel-complete` calls completion with a
  fixture whose authored bytes remain unchanged. Raw kernels include ABI reset
  and output consumption; they exclude input encoding/copying.

One streaming **operation is an entire replay**, including session creation.
Milliseconds per operation are not per-token latency. Fixture construction,
module compilation, imports, exact-output validation, and warmup stay outside
timers. The harness uses time-sized batches for small functions and one
iteration per batch when an operation exceeds the target duration. Normal GC
remains enabled; it neither forces GC nor subtracts estimated loop overhead.
Warm instances retain grown memory, so these measurements exclude cold-start and
first-growth latency.

### Read comparisons without overclaiming

The runner starts one fresh Node process for each case/variant/round and
executes them serially. It shuffles case order and balances baseline-first
versus candidate-first pairs using a recorded seed. Each process reports its
median batch-mean time. The comparison reports the geometric mean of paired
candidate/baseline ratios and a percentile-bootstrap 95% interval, resampling
whole process pairs. Loop iterations are not independent statistical samples.
Intervals describe this machine, runtime, and workload; they are not universal
performance guarantees.

The default practical threshold is 2%:

- `faster`: the whole interval is below 0.98.
- `slower`: the whole interval is above 1.02.
- `within-threshold`: the interval lies inside [0.98, 1.02].
- `inconclusive`: the interval crosses a practical boundary.

Confirmation requires at least eight pairs and an even round count. Quick
results remain exploratory even when an interval looks decisive. Use
`--rounds=24 --warmup-ms=1000 --sample-ms=50 --samples=12` for a longer fixed
run, or change `--threshold=0.01` for a 1% decision boundary. `--timeout-ms`
limits each worker, including validation and warmup. The runner never keeps
sampling until it finds significance.

`report.json` retains chronological batches, iteration counts, warmup work,
per-process summaries, pair order, output digests, fixture/driver/artifact
hashes, runtime and machine metadata, and failure status. Drift and dispersion
warnings mean you should inspect the samples and repeat under better conditions.
Memory readings around timing are observations, not peak-memory measurements.
Verification checks each delivered HTML result and the session's stable/pending
reconstruction before and after timing. Cross-target hashes cover semantic HTML,
so changing a safe checkpoint boundary can remain a valid optimization.

Before trusting small gains, run an A/A control:

```sh
moonx words:lab --ignore-ci-checks -- confirm --baseline=/tmp/words-before --candidate=/tmp/words-before --cases=static-string,stream-blocks-suffix
```

Use quick runs to choose experiments, then confirm the selected winner in a
fresh run. Repeated selection biases apparent wins, and per-case intervals are
not simultaneous confidence intervals for the whole matrix. Check regression
cases as well as the target case; do not average away a slower workload. A
kernel improvement does not establish an end-to-end win. Use the existing
browser benchmarks below when a change needs downstream DOM/highlighting
validation.

### Profile hot paths and repeated work

```sh
moonx words:lab --ignore-ci-checks -- profile --candidate=/tmp/words-after --case=stream-blocks-suffix
moonx words:lab --ignore-ci-checks -- profile --candidate=/tmp/words-after --case=stream-fence-suffix --duration-ms=5000
```

Open the resulting `.cpuprofile` in a CPU-profile viewer such as VS Code or
Speedscope. The sampled Wasm retains optimized function names; the builder
checks that its executable sections match the production binary byte for byte.
Inlined functions may not have separate frames. The profile uses a private copy
of the capture and never rewrites `dist` or the original capture.

A separate instrumented build records block analysis, inline/render, completion,
`encodeInto`, input copying, and decoding. Its JSON also records core calls,
actual source bytes submitted, completion-repaired bytes, cache hits, reset
results, definition-bearing calls, and observed Wasm memory growth. The source
reprocessing ratio divides submitted source bytes by final source size across
the replay. It includes stable-prefix rerenders and definition fallbacks.

**Diagnostic timings are perturbed and overlap.** Renderer time includes core
time; core time includes stage probes. Do not sum them or subtract them from
normal benchmark results. The three-operation probe-cost comparison indicates
instrumentation impact, not a correction factor. Memory growth counters observe
page deltas at call boundaries after warmup, not individual `memory.grow`
instructions. Exact output parity must hold for production, named, and
instrumented builds.

The implementation lives in `benchmark/lab/`. Add workloads in `cases.mjs`; keep
fixture preparation and validation out of `run()`. Internal block and inline
phases share mutable Wasm state, so the lab observes them in place rather than
timing unsafe standalone calls against stale records.

### Initial instrumentation check

On Node 24.11.0, a 12-pair A/A run classified static-string, block-stream, and
open-fence replay as `within-threshold` at 2%. Estimated time differences were
below 0.5%; this checks local noise rather than proving sub-percent accuracy.
All 29 cases completed their quick-run output checks.

The diagnostic replay exposed different amounts of repeated parsing:

| Case                | Updates per replay | Core renders per replay | Submitted source / final source |
| ------------------- | -----------------: | ----------------------: | ------------------------------: |
| Completed blocks    |                 46 |                      92 |                           2.44× |
| Long open paragraph |                 77 |                      77 |                          39.25× |
| Open fence          |                 73 |                      74 |                          37.21× |
| Late definitions    |                 24 |                      47 |                           4.29× |

These are work counts, not speedup estimates. The repeated-delivery case
produced 92 cache hits per replay and the same core work as the block stream.
Open-tail completion and reparsing are candidates to investigate; no parser
optimization was made as part of this instrumentation.

Run `moon run words:lab-test` to check workload replay/parity and comparison
statistics. It builds the core before running integration checks.

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
