# Words benchmarks

## Local parser optimization

Use `words:lab` for local optimization experiments. It needs the normal
workspace dependencies, but no competitor harness, browser download, or mitata.
Run it on an idle machine, on power, without concurrent builds or benchmarks.

```sh
moonx words:lab --ignore-ci-checks -- list
moonx words:lab --ignore-ci-checks -- capture --output=/tmp/words-before
# After an implementation change, Moon rebuilds before capturing the candidate.
moonx words:lab --ignore-ci-checks -- quick --baseline=/tmp/words-before --output=/tmp/words-screen
moonx words:lab --ignore-ci-checks -- capture --output=/tmp/words-after
moonx words:lab --ignore-ci-checks -- confirm --baseline=/tmp/words-before --candidate=/tmp/words-after --output=/tmp/words-confirm
```

The lab measures the WAT core, `lib/index.mjs` encoding/decoding and session
bookkeeping, and `html/render.ts` formatting. Include all three in the search
space: a faster kernel need not improve a streaming consumer. DOM patching,
React, highlighting plugins, cold startup, and network pacing remain outside
this lab. Use the browser harness below for downstream checks on finalists. Node
measurements do not establish browser performance or a universal ceiling on WAT
improvements.

Captures contain optimized Wasm, glue, WAT sources, the build helper, and a
self-contained `html.mjs` bundle built from the captured HTML sources against
the captured glue. Hashes and environment metadata identify the artifacts. The
runner rejects modified captures and existing output directories. An omitted
candidate captures the current build. Relative paths resolve from
`packages/words`; default results live in gitignored `benchmark/output/lab/`.

### Fixed objective and regression guards

`lab/policy.mjs` defines `words-streaming-lifecycle-v1`. Freeze this file,
workloads, fixtures, tests, and the benchmark driver during a search. Change the
measurement contract between searches, not to accommodate a candidate.

| Role                    | Cases                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Objective, equal weight | `stream-assistant-token`, `stream-assistant-chunk`, `stream-paragraph-suffix`, `stream-fence-suffix`, `html-assistant-chunk` |
| Regression guards       | `static-bytes`, `static-string`, `static-ansi`, `stream-review-chunk`, `stream-definitions-suffix`                           |

All ten run by default. `list` labels objective cases `O` and guards `G`. The
objective score is the geometric mean of objective candidate/baseline time
ratios; lower is better. Guards do not dilute that score, but can block
acceptance. A localized objective win can nominate a candidate even when its
contribution to the score is below the screening threshold.

`--cases=id,id` selects diagnostic workloads. Missing fixed-suite cases prevent
acceptance, and `scoreComplete` identifies partial objective scores. Do not rank
scores computed from different subsets. `--cases=all` exercises the broader
matrix; additional cases act as guards, never as extra objective weights.

### Screening, confirmation, and acceptance

| Mode      | Warmup minimums per process                                                        | Samples and comparisons                                  | Purpose                                                               |
| --------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| `quick`   | 75 ms and 20,000 replay deliveries, or 400 static/kernel operations; 3 s cap       | 5 batches targeting 15 ms; 4 pairs with a baseline       | Nominate experiments at a 3% per-case threshold; never accept         |
| `confirm` | 1,000 ms and 60,000 replay deliveries, or 1,200 static/kernel operations; 10 s cap | 9 batches targeting 30 ms; 12 fresh pairs                | Confirm selected winners under longer warmup and 2% regression guards |
| `profile` | 250 ms and 20,000 replay deliveries, or 400 static/kernel operations; 5 s cap      | 3 s of CPU sampling, then a separate instrumented replay | Find hot functions and repeated work; no speedup verdict              |

Each case/variant/round gets a fresh Node process. Workers execute serially,
case order is seeded and shuffled, and baseline-first/candidate-first pairs are
balanced. A process reports the median of its batch-mean times. Per-case ratios
use the geometric mean across process pairs.

Quick mode reports point estimates only, even with extra rounds. Its statuses
are `promising`, `regression-suspected`, or `no-signal`; measurement warnings
override these with `invalid`. None sets `accepted: true`. Three percent is a
screening choice, not a calibrated noise bound: an earlier four-pair A/A run
reported a 5.66% token-streaming regression on identical captures.

Confirmation bootstraps whole process pairs, not the correlated iterations
inside a batch. It requires at least eight pairs and allocates a nominal 5%
error budget across the measured cases using Bonferroni-adjusted intervals
(99.5% per case for the default ten). `ratioInterval` and `confidence` record
the actual interval and level. Bootstrap coverage remains approximate,
particularly with few process pairs; this is not a guarantee against false wins.

At the default 2% practical threshold, a per-case interval wholly below 0.98 is
`faster`, wholly above 1.02 is `slower`, contained in [0.98, 1.02] is
`within-threshold`, and otherwise is `inconclusive`. Acceptance requires:

- A full fixed-suite confirmation meeting the longer-warmup and sampling
  minimums.
- No measurement warnings.
- At least one objective case with an interval wholly below the improvement
  boundary.
- An objective score below 1.
- Every measured case's interval upper bound at or below the regression
  boundary.

An uncertain improvement in another case is acceptable as a guard only when its
interval excludes a material regression. A known regression yields `regressed`;
unresolved regression risk yields `inconclusive`. Missing suite cases or reduced
confirmation settings yield `diagnostic-only`, never acceptance. An unchanged
objective yields `unchanged`; a faster guard alone is not an objective win.

`summary.json` schema 2 separates `score` from `status` and **`accepted`**. It
includes objective coverage, confirmed wins, unresolved cases, invalid cases,
regressions, and qualification issues. A loop must require `accepted === true`
for performance acceptance, not infer it from a low score or an individual
`promising` label. Correctness tests remain a separate required gate. A non-zero
command exit indicates an execution or output-parity failure; an invalid or
inconclusive measurement can exit zero with `accepted: false`.

Use `--rounds=24 --sample-ms=50 --samples=12` for a longer fixed confirmation.
Predeclare `--threshold=0.01` if a 1% practical boundary matters; the smaller
effect may require more samples. A threshold above 2% relaxes the fixed guard
and makes confirmation diagnostic-only. There is no promised minimum detectable
effect. The runner does not sample until it finds significance.

### Warmup and measurement validity

Earlier Node runs showed timing changes after many deliveries. The count floors
reduce the chance of measuring a transient regime, but are baseline calibration,
not proof of a JIT tier or of steady state in every candidate. Browser behavior
requires browser evidence.

Both elapsed-time and work-count requirements must be satisfied.
`--warmup-max-ms` below `--warmup-ms` is an error. Workers record both achieved
conditions and 25 ms warmup trajectory windows. The following invalidate a
comparison rather than merely printing advisory text:

- A process reaches its warmup cap before satisfying both floors.
- Within-process relative MAD exceeds 10%.
- First-half versus last-half batch medians differ by more than 10%.
- The largest process-pair ratio exceeds the smallest by more than 10%.

The last check catches process-level shifts that stable batches can miss. These
gates are heuristics, not exhaustive noise detection. Inspect raw data and
repeat a predeclared fixed run under better conditions when a gate trips. Do not
drop unfavorable pairs or retry until a result passes. `--timeout-ms` bounds
each worker, including validation and warmup.

### Workloads and timing boundaries

`list` reports sizes, delivery counts, and boundaries. The broader matrix covers
GFM, an approximately 850 KB stress input, ANSI and wrapping, frontmatter,
Unicode, malformed input, tables, late definitions, edits, repeated deliveries,
hooks, and UTF-8/copy/render/completion kernels.

The two `fixtures/assistant-*.md` documents are authored synthetic
assistant-style responses, not captured production transcripts. They mix fences,
lists, tables, links, and non-ASCII text. Seeded token deliveries contain 1–12
UTF-16 units, skewed small; seeded network chunks contain 16–96. Older
fixed-step streams use 64 units, with 8/1024-unit block contrasts. Split
surrogate pairs are intentional. Byte counts and UTF-16 counts are separate.

- `static-*`: one document. Byte-input cases include copying into Wasm;
  string-output cases include decoding. ANSI width and frontmatter parsing
  belong to the operation where enabled.
- `stream-*-full`: render every accumulated prefix from scratch.
- Session cases: create a fresh session and consume `addition` and `pending`.
  `stream-blocks-session` requests full HTML on the same deliveries.
- `html-*`: replay through `createHtmlRenderer`; the hooks case includes element
  and inline-code hooks. `html-fence-chunk` exercises an unfinished fence
  settling.
- Kernels: prepared-buffer encoding/copying/decoding, or raw production Wasm
  exports over valid preloaded input. ABI reset and output consumption remain
  inside timing; input construction does not.

Every streaming replay includes its final settled delivery: the final source
again with `incomplete=false`, and `active=false` for HTML formatting. Existing
explicit transitions remain intact; an already-settled final delivery is not
duplicated. This transition is timed and verified, not deferred to disposal.
Descriptor flags and fixture hashes identify the lifecycle. HTML verification
also compares the final document with a fresh settled render.

One operation is a whole document or replay, including session creation and
settlement. It is not per-token latency. Imports, compilation, fixture setup,
warmup, and exact verification stay outside timers. Small operations use
time-sized batches; long operations can occupy one iteration per batch. Normal
GC remains enabled, without forced collection or overhead subtraction. Instances
retain grown memory, excluding cold-start and first-growth latency.

`report.json` retains chronological batches, pair order, warmup trajectories,
memory observations, environment metadata, and artifact/fixture/driver hashes.
Verification covers every delivered document before and after timing, including
stable/pending reconstruction. Cross-target hashes cover semantic output, not
checkpoint partitioning. Intermediate and final output digests are also
recorded. Memory observations are not peak-memory measurements.

### Search protocol

Keep the starting capture and compare each candidate against the current
incumbent using fresh pairs. Use narrow runs to investigate, then the fixed
suite to screen. Treat a localized `promising` result as a reason to confirm,
not a reason to publish a win.

For a selected candidate:

1. Run `moon run words:test`; lab fixture hashes do not replace the conformance,
   seeded fuzz, streaming, ANSI, and React correctness suites.
2. Run a fresh default `confirm` against the saved incumbent. It uses the
   predeclared longer warmup and all objective/guard cases.
3. Require `accepted: true` and passing correctness checks before keeping it on
   performance grounds. Preserve inconclusive results as inconclusive.
4. Check finalists against the starting capture and the existing browser harness
   when changes affect downstream DOM/highlighting behavior.

Run an A/A control before trusting a search session:

```sh
moonx words:lab --ignore-ci-checks -- quick --baseline=/tmp/words-before --candidate=/tmp/words-before
moonx words:lab --ignore-ci-checks -- confirm --baseline=/tmp/words-before --candidate=/tmp/words-before
```

Repeated selection still biases apparent wins. Freeze candidate selection before
the confirmation run; a passing A/A control does not certify future
measurements. Expect the full longer-warmup confirmation to take substantially
longer than quick screening.

The readiness controls on Node 24.11.0 / Apple M3 Max exercised the full fixed
suite without accepting a false win:

| Control                       | Runtime, excluding build | Decision                    |
| ----------------------------- | ------------------------ | --------------------------- |
| Four-pair quick A/A           | 29 s                     | `invalid`, `accepted=false` |
| Twelve-pair longer-warmup A/A | 350 s                    | `invalid`, `accepted=false` |

The longer run still found between-process variation in `stream-assistant-chunk`
and within-process drift in `html-assistant-chunk`. These controls verify that
the decision path refuses unstable evidence; they do not establish a calibrated
search session. Obtain a stable A/A control before unattended keep/revert use.
Investigate persistent timing modes rather than relaxing gates to make a control
pass.

### Profile hot paths and repeated work

```sh
moonx words:lab --ignore-ci-checks -- profile --candidate=/tmp/words-after --case=stream-blocks-suffix
moonx words:lab --ignore-ci-checks -- profile --candidate=/tmp/words-after --case=html-fence-chunk --duration-ms=5000
```

Open `.cpuprofile` in a CPU-profile viewer such as VS Code or Speedscope. The
named optimized Wasm must have identical executable sections to production.
Captured JS frames map to the actual `index.mjs` or `html.mjs` entry. The
profile uses a private capture copy and never rewrites the original or `dist`.

A separate instrumented replay records block analysis, inline/render,
completion, encoding, input copying, decoding, core calls, submitted/repaired
bytes, and observed Wasm page growth. Core-session cases observe session
updates, cache hits, and resets. HTML's internal session bypasses that observer,
so its session counters are **null**, with `sessionObservation.available=false`
and a reason. Unavailable observations are not measured zeros.

Profiles record achieved warmup counts, time, floor status, and warnings for
both the named and instrumented workloads. A capped profile is diagnostic only.
All probe timings are perturbed and inclusive: do not sum them, subtract them
from headline timings, or use the three-operation probe comparison as a
correction factor. Observed page changes are not counts of `memory.grow`
instructions. Production, named, and instrumented outputs must match.

Earlier diagnostic work counts omitted settlement and used a different suite.
Rerun profiles and controls rather than comparing their totals or aggregate
scores directly with the lifecycle suite.

The implementation lives in `benchmark/lab/`. Internal block and inline phases
share mutable Wasm state, so the lab observes them in place rather than timing
standalone calls against stale records. Run `moon run words:lab-test` for the
measurement-policy, warmup, replay, and diagnostic regression tests.

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
