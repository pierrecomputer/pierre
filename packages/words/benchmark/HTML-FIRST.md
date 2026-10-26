# HTML-first measurements — October 22, 2026

This report records the initial rewrite and selection-handling follow-up. See
the [current benchmark report](./CURRENT.md) for the complete rerun after the
subsequent cleanup, including large animated memory measurements.

The initial HTML-first renderer reduced large-message update work and retained
JavaScript heap, but its original fade implementation had a serious
large-message regression. Removing custom selection handling resolved that 100×
regression in the follow-up below. The original 1,000× non-animated case remains
visibly janky. Faster HTML generation does not by itself make an arbitrarily
large live DOM smooth.

These measurements describe the new HTML-string/native-DOM path, with React
owning only its outer container. The earlier object-tree report remains
[historical](./COMPARISON.md). Raw measurements, versions, and build hashes are
saved in [the October 22 result file](./results/2026-10-22-html.json).

## Follow-up: custom selection handling removed

All custom selection queries, range checks, deferred expiry, and
selection-change listeners were removed from the native renderer. Fade creation
and expiry no longer inspect browser selection state. Spans still expire and
merge into plain text normally.

The same production 100× highlighted + fade case was repeated in three fresh
browsers. All delivered 267 updates, produced the same semantic text hash as the
original comparison, highlighted all 100 fences, and ended with no fade wrappers
or runtime errors.

| 100× highlighted + fades |              Original implementation | Selection handling removed |
| ------------------------ | -----------------------------------: | -------------------------: |
| Settled replay           | Timed out at 180 s after 207 updates |                    13.83 s |
| Update p95               |                       Incomplete run |                     6.0 ms |
| Frame p95                |                       Incomplete run |                    16.7 ms |
| Long tasks               |                       Incomplete run |                          0 |

New values are medians of three complete replays. The producer still
deliberately waits 40 ms between commits, so elapsed time is not pure rendering
throughput.
[Raw follow-up runs and build hashes](./results/2026-10-22-no-selection.json)
are saved separately. This follow-up remeasures animation timing only; the
parser, heap, footprint, and 1,000× measurements below remain the earlier
snapshot.

## Production browser comparison

Apple M4 Max, 16 logical CPUs, 128 GiB RAM, macOS arm64, Node 24.11.0, headless
Chrome 156.0.8078.47, production React 19.2.7, Streamdown 2.7.1,
`@streamdown/code` 2.0.0. The same fixture, viewport, React build, 40 ms
commit-paced delivery schedule, and disabled controls/line numbers apply to both
renderers. Highlighters are warmed on different content before measurement.
Neither tracing nor DOM sampling runs during these primary timing replays.

The fixtures are 8,524 / 852,598 / 8,525,998 ASCII characters. Chunks scale with
document size to keep 267 updates: 32 / 3,200 / 32,000 characters. This tests
larger deliveries as well as larger accumulated documents; it is not a fixed
token-rate model. Reported commit time ends at the parent layout effect, before
following paint or asynchronous highlighter callbacks. Frame intervals are
measured during playback; long tasks include final settlement.

| 1× configuration    | Pierre update p95 | Streamdown update p95 | Pierre frame p95 | Streamdown frame p95 |
| ------------------- | ----------------: | --------------------: | ---------------: | -------------------: |
| Plain               |            1.2 ms |                3.3 ms |          16.7 ms |              16.7 ms |
| Highlighted         |            2.9 ms |                3.2 ms |          16.7 ms |              16.7 ms |
| Highlighted + fades |            4.4 ms |                3.8 ms |          16.8 ms |              16.8 ms |

These are medians of three fresh-browser runs. All 18 small runs delivered every
update, matched normalized paragraph/code text, and reported no runtime errors
or long tasks. The HTML-first path does not win every small-message mode.

| 100× configuration  |      Pierre update p95 | Streamdown update p95 |  Pierre frame p95 | Streamdown frame p95 |
| ------------------- | ---------------------: | --------------------: | ----------------: | -------------------: |
| Plain               |                 3.1 ms |               21.2 ms |           16.7 ms |              16.7 ms |
| Highlighted         |                 4.9 ms |               21.6 ms |           16.7 ms |              16.8 ms |
| Highlighted + fades | **Timed out at 180 s** |               34.3 ms | **Severe stalls** |              66.7 ms |

Plain/highlighted values are medians of three runs. Pierre reported zero long
tasks in those six runs; Streamdown's median counts were zero/plain and
two/highlighted. Highlighted settled replays were 12.73 s / 16.45 s, including
the deliberately paced producer. Thus the 4.4× update-latency ratio is not a
4.4× end-to-end replay speedup.

The large animated Pierre run reached only 207/267 updates before the bound. Its
**partial**, incomplete measurements were 1,002.9 ms update p95, 799.9 ms frame
p95, and 534 long tasks. These must not be presented as completed-run
percentiles. Streamdown completed its one fresh animated comparison in 28.13 s,
with 105 long tasks. Further large animated repeats and the 1,000× animated case
were intentionally cancelled after establishing this failure. The raw matrix
therefore contains 31 completed runs and one timeout, rather than the originally
planned 36 completed replays.

Both successful large non-animated configurations matched normalized text, all
100 fences were highlighted when enabled, and no runtime errors were reported.
The programs repeat across fences, allowing Streamdown's native highlight cache
to reuse results. Pierre fades delivery chunks including code; Streamdown fades
prose words and skips code. Streamdown also retains its native code-container
`content-visibility: auto`; Pierre does not use it. These are native configured
behaviors, not identical animation or language-coverage implementations.

### 1,000× capacity check

One additional Pierre-only highlighted run, with fades disabled, completed all
267 updates in 33.30 s including settlement. It rendered 101,000 paragraphs,
1,000 highlighted fences, and 889,281 elements. Update p95 was 29.7 ms, frame
p95 was 116.7 ms, and 162 long tasks occurred. There were no runtime errors or
retained fade wrappers. This is a single stress diagnostic, not a repeated
Streamdown comparison or evidence of smooth 8.5 MB rendering.

## Parser work and memory

The new `bench-html` task measures HTML strings without React, DOM, formatting
hooks, or highlighting. Five timed replays follow one untimed replay,
alternating full/incremental order. Every one of the 267 sampled prefixes is
checked against a fresh parse outside the timing section.

| Workload                               | 1× / 8.5 KB | 100× / 0.85 MB | 1,000× / 8.53 MB |
| -------------------------------------- | ----------: | -------------: | ---------------: |
| Complete HTML string, median call      |    0.048 ms |        4.50 ms |         44.55 ms |
| Full HTML reparse, 267 updates total   |     6.76 ms |      602.95 ms |      6,019.57 ms |
| Incremental HTML, 267 updates total    |     0.88 ms |       51.63 ms |        514.51 ms |
| Full/incremental work ratio            |        7.7× |          11.7× |            11.7× |
| Retained session JS heap increase      |    0.020 MB |       1.283 MB |        12.701 MB |
| Session HTML characters                |      12,666 |      1,266,600 |       12,666,000 |
| Incremental Wasm arena high-water mark |     128 KiB |        128 KiB |          192 KiB |

Memory is a separate replay after replacing the shared arena, with source
already present in the baseline and two explicit GCs per sample. Releasing the
caller output leaves the session's cached strings retained; releasing the
session returns reported heap close to baseline. This is not allocation-free:
the completed HTML string occupies memory proportional to output size.

The small Wasm arena figures apply to these bounded append chunks starting from
a fresh arena. A previous full-document parse can leave a much larger shared
arena committed; session release does not shrink it. Benchmark arena replacement
is isolation, not a public memory-trimming API. Node heap and Wasm commitment
are separate counters and must not be summed with browser measurements.

At 64 characters/update, mutable-tail cases offered no parser speedup:

| Input                                   | Full replay | Incremental replay |
| --------------------------------------- | ----------: | -----------------: |
| One open paragraph, 18,000 characters   |    12.69 ms |           13.64 ms |
| One open code fence, 18,014 characters  |     6.80 ms |            7.79 ms |
| Reference definitions, 8,539 characters |     3.34 ms |            3.62 ms |

All sampled prefixes matched. Completed-block reuse helps when there are
completed blocks to reuse; mutable tails and definition fallbacks still cost
work, with some session overhead.

## Browser heap diagnostic

Browser heap samples are collected separately from primary timings. A fresh
browser measures its warmed empty baseline, settled output, and keyed empty
reset, after two explicit GCs at each stage. Active DOM counts run only in these
diagnostic replays. Their playback timings are excluded from comparison.

| 100× highlighted, fades disabled   |  Pierre | Streamdown |
| ---------------------------------- | ------: | ---------: |
| Warmed empty heap                  | 3.07 MB |    9.18 MB |
| Settled heap                       | 9.47 MB |  140.43 MB |
| Retained heap increase             | 6.40 MB |  131.26 MB |
| Empty-reset heap                   | 4.36 MB |   26.26 MB |
| Empty-reset increase over baseline | 1.29 MB |   17.09 MB |

Values are medians of three fresh-browser diagnostic samples, using decimal MB.
Medians of deltas are calculated per sample and need not equal differences
between medians. No samples reported errors. Compared with the historical
tree-renderer's 67.73 MB retained increase for the same highlighted fixture, the
new 6.40 MB figure is about 91% lower; that historical memory value was a single
diagnostic sample, so this is an indicative before/after comparison.

The completed large animated case could not be sampled because playback timed
out. Its absence must not be interpreted as good animation memory behavior. The
small animated diagnostic is recorded in the raw results separately; it cannot
establish large-case capacity.

Chromium's `performance.memory.usedJSHeapSize` is reported JS heap, not total
RAM or complete native-DOM/Wasm/GPU accounting. DOM counts are structural, not
byte estimates. Reset deltas can include shared caches and runtime state; these
samples do not prove or disprove a leak.

## Configured footprint

Same esbuild 0.27.4, minified ES2022 browser ESM, React/React DOM external, gzip
level 9 per output file. These are configured consumer transfer sizes, not
complete npm tarball sizes or browser memory. CSS is separate.

| Configured entry                                 |    Pierre | Streamdown |
| ------------------------------------------------ | --------: | ---------: |
| Framework-independent HTML renderer              |  48,351 B |          — |
| Base React renderer, initial gzip                |  48,855 B |  158,047 B |
| Renderer + TypeScript + two themes, gzip closure | 169,642 B |  239,413 B |

Pierre's highlighter ships its grammar set together; Streamdown imports
individual grammars lazily. The highlighted closure includes the default GitHub
Light/Dark and highlighted-body lazy imports for Streamdown, and Pierre
Light/Dark for Pierre. Other optional languages/plugins are excluded from that
row. Compared with the historical Pierre entries, the new renderer's transfer
size is essentially unchanged; the rewrite's gains are runtime work and heap,
not a large bundle reduction.

## Next work from the initial snapshot

1. Completed: profiling isolated repeated `Selection.isCollapsed` reads between
   DOM mutations as the source of synchronous document layouts. All custom
   selection handling was subsequently removed.
2. Completed: the same 100× fade case was rerun successfully above. Active and
   settled heap after this removal have not been remeasured.
3. Investigate browser rendering/layout costs and ways to limit work on distant
   completed content for the 1,000× case. Large DOM size remains even when
   parsing work and JavaScript trees have been reduced.

## Reproduce

Competitor dependencies remain isolated from the workspace, pinned to the
versions above, together with React/React DOM 19.2.7 and esbuild 0.27.4.

```sh
moon run markdowns:bench-html -- /tmp/html.json
moon run markdowns:bench-render-compare -- --deps=/tmp/markdowns-streamdown-setup-20261021/node_modules --output=/tmp/html-browser --scales=1,100 --runs=3
moon run markdowns:bench-render-compare -- --deps=/tmp/markdowns-streamdown-setup-20261021/node_modules --output=/tmp/html-stress --libraries=pierre --scales=1000 --modes=highlight --runs=1
moon run markdowns:bench-footprint -- /tmp/markdowns-streamdown-setup-20261021/node_modules /tmp/html-footprint
```

For separate memory diagnostics, keep prepared production bundles served with
`bench-render-compare --skip-build --serve-only`, then supply its printed URL:

```sh
moon run markdowns:bench-memory -- http://127.0.0.1:PORT /tmp/heap-highlight.json highlight 100 3
moon run markdowns:bench-memory -- http://127.0.0.1:PORT /tmp/heap-animated-small.json animated 1 1
```

The comparison runner now awaits browser subprocesses asynchronously, allowing
its own HTTP server to serve them. No library implementation was changed while
collecting these results.
