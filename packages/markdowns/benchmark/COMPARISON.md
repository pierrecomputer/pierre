# Current performance and Streamdown comparison

Measured October 21, 2026 on an Apple M4 Max, 16 logical CPUs, 128 GiB RAM,
macOS arm64, Node 24.11.0. Browser comparisons use production React 19.2.7 in
headless Chrome. Streamdown is 2.7.1, `@streamdown/code` is 2.0.0, and its
resolved Shiki is 4.5.0. Competitor dependencies live outside the workspace;
they are not library or docs dependencies.

## Direct browser method

`compare-browser.mjs` builds separate production browser entry points with the
same React/React DOM, source, fonts, viewport, delivery schedule, and disabled
code controls/line numbers. It warms the renderer and TypeScript highlighter on
different content, mounts an empty renderer, then delivers every prefix. The
test program is not preloaded into the completed-code cache. Each measured
replay gets a fresh browser session. Library order alternates between repeated
runs.

The 1× fixture is 8,524 ASCII characters; 100× is 852,598 characters. Delivery
uses 32 / 3,200 characters per update with a requested 40 ms interval: 267
updates in either case. The producer waits for React commits, so replay elapsed
is not fixed-rate throughput. Measurements exclude cold startup and network.
There is no Chrome trace, DOM sampling during playback, or asymmetric
`JSON.stringify` instrumentation in the direct comparison.

Three configurations separate plain rendering, highlighting, and highlighting
with native 180 ms fades. Pierre uses its Light/Dark themes; Streamdown uses
GitHub Light/Dark. Code fonts and maximum height are normalized. Two meaningful
native differences remain:

- Streamdown uses `content-visibility: auto` on its code containers. Pierre
  keeps all code content available to layout.
- Pierre fades delivered chunks, including code, then compacts expired spans.
  Streamdown fades prose words, skips code fades, and keeps word wrappers while
  the stream is active; the completed output has no retained fade wrappers.

The fixture repeats the same TypeScript program. Streamdown's shared cache can
reuse highlighted results between identical fences. These are repeated-content
capacity measurements, not a claim about 100 distinct programs. Its current
Markdown splitter and code plugin both perform incremental work; this comparison
does not assume that Streamdown reparses or highlights the entire message on
every append.

Commit latency runs from requesting the next prefix to the parent's layout
effect. It excludes subsequent paint and asynchronous highlighting callbacks.
Producer elapsed ends at the final parent commit. Settled elapsed additionally
waits for pending code callbacks, at least 330 ms for fades, and two frames.
Long-task reporting includes that settling window; frame percentiles describe
playback up to the final parent commit, excluding its subsequent render-to-frame
interval. Final paragraph/code text is checked after normalizing whitespace;
different headers, trailing code rows, and DOM wrappers are recorded separately.

## Direct browser results

Values are medians of three replays per library and configuration. Both
libraries produced the same normalized paragraph/code text, delivered all 267
updates, and reported no runtime errors in the 1× runs.

| 1× configuration | Pierre commit p95 | Streamdown commit p95 | Pierre frame p95 | Streamdown frame p95 |
| --- | ---: | ---: | ---: | ---: |
| Plain | 1.3 ms | 3.8 ms | 16.8 ms | 16.7 ms |
| Highlighted | 2.1 ms | 3.7 ms | 16.7 ms | 16.7 ms |
| Highlighted + native fades | 2.9 ms | 4.0 ms | 16.7 ms | 16.8 ms |

All 18 small replays reported zero long tasks. Our lower commit latency gives
more update headroom; both renderers already fit the frame budget on this small
message. The highlighted/fading median producer replays were 11.29 / 11.70 s
(Pierre / Streamdown), with settled times of 11.65 / 12.07 s. Most of that time
is the deliberately paced 40 ms producer, rather than rendering work.

| 100× configuration | Pierre settled replay | Streamdown settled replay | Pierre frame p95 | Streamdown frame p95 |
| --- | ---: | ---: | ---: | ---: |
| Plain | 13.25 s | 16.13 s | 16.8 ms | 16.8 ms |
| Highlighted | 13.28 s | 16.39 s | 16.7 ms | 16.8 ms |
| Highlighted + native fades | 14.29 s | 27.86 s | 16.7 ms | 66.7 ms |

| 100× configuration | Pierre commit p95 | Streamdown commit p95 | Pierre long tasks | Streamdown long tasks |
| --- | ---: | ---: | ---: | ---: |
| Plain | 6.5 ms | 21.7 ms | 0 | 0 |
| Highlighted | 6.8 ms | 22.1 ms | 0 | 2 |
| Highlighted + native fades | 6.5 ms | 32.9 ms | 0 | 112 |

Pierre reported no long tasks in any of its 18 matched runs. Streamdown's large
highlighted replays each reported two tasks totaling 318 / 316 / 319 ms, with
the largest around 250 ms. Their cause was not established by this untraced
comparison.

With native fades at 100×, Streamdown reported 92 / 112 / 112 long tasks. Their
median total duration was 8.77 s and median largest task was 1.14 s; the largest
individual task across all three runs was 1.23 s. The final DOM contained
96,801 / 94,901 elements for Pierre / Streamdown, respectively; both retained
zero fade wrappers after completion. Their paragraph/code text matched,
including all 100 highlighted fences.

The animated producer reached its final commit in 13.93 / 27.50 s; the table
above also includes asynchronous/fade settlement. This is a substantial
responsiveness difference for this workload, not a general 2× parser-speed
claim. Native animation allocation and cleanup differ, and the full docs page
still has higher frame intervals than the isolated renderer, as shown below.

## Existing production docs rerun

Three untraced replays at each size, with highlighting, line numbers, code
controls, and 180 ms fades enabled. This uses the original docs harness,
including its block-serialization instrumentation, so it is a historical check
and is separate from the matched comparison above.

| Measurement                            |           1× |           100× |
| -------------------------------------- | -----------: | -------------: |
| Median producer elapsed                |      11.26 s |        21.91 s |
| Median frame interval p95              |      16.7 ms |        33.4 ms |
| Median frame interval p99              |      16.8 ms |        50.0 ms |
| Largest frame interval across all runs |      16.8 ms |        66.7 ms |
| Long tasks per run                     |    0 / 0 / 0 |      0 / 0 / 7 |
| Total long-task time per run           | 0 / 0 / 0 ms | 0 / 0 / 387 ms |
| Completion long tasks                  |            0 |              0 |
| Final elements                         |        1,011 |        101,100 |
| Retained fade spans after settling     |            0 |              0 |

No page errors were captured. The seven long tasks in the third 100× run were
append tasks lasting 50–60 ms. Steady frame pacing is consistent with the prior
33.4 ms p95 result; this rerun does not demonstrate another frame-rate gain.

## Parser and tokenization rerun

These are our APIs alone, excluding React, DOM, layout, paint, and Streamdown.
The incremental replay uses 64-character chunks, one warmup, five measured
replays, alternating measurement order, and median accumulated work.

| Workload                                        | Full reparse | Incremental |  Ratio |
| ----------------------------------------------- | -----------: | ----------: | -----: |
| Completed Markdown blocks, 14,820 characters    |     103.6 ms |      3.2 ms | 32.68× |
| One open paragraph, 16,500 characters           |      38.3 ms |     38.7 ms |  0.99× |
| Reference definition halfway, 29,656 characters |     397.6 ms |    298.6 ms |  1.33× |
| TypeScript tokenization, 25,170 characters      |      42.2 ms |      5.2 ms |  8.09× |

Warm raw HTML throughput on the 211 KiB GFM fixture was 297 MB/s for string
input/output, or 521 MB/s for borrowed byte input/output. The corresponding
median calls were 729 µs / 415 µs. This is not a Streamdown React comparison.

| Larger parser-only fixture           | 100× / 0.85 MB | 1,000× / 8.53 MB |
| ------------------------------------ | -------------: | ---------------: |
| Median borrowed HTML render          |         3.0 ms |          24.4 ms |
| Median owned-element render          |        36.0 ms |         339.1 ms |
| Owned-output JS heap increase        |        17.4 MB |         172.6 MB |
| Structured-render Wasm arena         |      10.25 MiB |           98 MiB |
| Sparse append work, 16 updates total |        71.0 ms |         721.6 ms |
| Maximum sparse append                |         6.4 ms |          54.0 ms |

All 16 sampled prefixes matched a fresh parse at both sizes. Heap and Wasm arena
are separate counters, not a combined total. These runs do not include the
browser DOM or highlighter instances and do not establish 1,000× browser
capacity.

## Bundled footprint

Same esbuild 0.27.4, minified ES2022 browser ESM, with React/React DOM external.
Files are compressed independently with gzip level 9. CSS is separate. No Math,
Mermaid, or CJK plugins are included. This is a transfer-size comparison, not a
cold-load timing or browser-memory measurement.

| Configured consumer entry                              |    Pierre | Streamdown |
| ------------------------------------------------------ | --------: | ---------: |
| Base React renderer, initial gzip                      |  48,680 B |  158,049 B |
| Renderer + highlighter + TypeScript + two themes, gzip | 169,188 B |  239,396 B |
| Published CSS only, gzip                               |     960 B |      447 B |

Streamdown base has another 470 B gzip of optional lazy assets. The highlighted
row includes the TypeScript/default-theme/highlighted-body import closure, not
every optional language chunk. Pierre's configured plugin imports Pierre
Light/Dark. Its monolithic highlighter supports 81 grammar IDs including plain
text, while Streamdown's code plugin exposes 346 canonical languages and loads
them lazily. Application-specific Streamdown Tailwind utility CSS is excluded.
The bundles therefore have different feature/language coverage.

## Reproduce

Existing parser and docs tasks:

```sh
moon run markdowns:bench markdowns:bench-stream
moon run markdowns:bench-large -- 100 16 /tmp/markdowns-large-100.json
moon run markdowns:bench-large -- 1000 16 /tmp/markdowns-large-1000.json
moon run markdowns:bench-render -- http://localhost:3690/markdowns current /tmp/markdowns-current 100 3 --no-trace
```

For the direct comparison, supply an isolated `node_modules` containing
`streamdown@2.7.1`, `@streamdown/code@2.0.0`, `react@19.2.7`,
`react-dom@19.2.7`, and `esbuild@0.27.4`, installed with pnpm outside this
workspace. The task builds both entries, starts a temporary local server, runs
the matrix serially, saves JSON, and closes its browsers/server:

```sh
moon run markdowns:bench-render-compare -- --deps=/tmp/markdowns-streamdown-bench/node_modules --output=/tmp/markdowns-comparison
```

Use `--libraries=pierre,streamdown`, `--modes=plain,highlight,animated`,
`--scales=1,100`, `--runs=3`, or `--timeout=180000` to select bounded subsets.
The default matrix has 36 replays. `--prepare-only` only builds; `--skip-build`
reuses previously prepared bundles. Inspect `metadata.json`, `summary.json`, and
per-run errors before drawing conclusions from an incomplete matrix.

Current implementation references:
[Streamdown configuration](https://streamdown.ai/docs/configuration),
[code plugin](https://streamdown.ai/docs/plugins/code),
[animation](https://streamdown.ai/docs/animation), and
[memoization](https://streamdown.ai/docs/memoization).
