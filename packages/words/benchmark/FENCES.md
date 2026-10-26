# Mutable code fence improvements — October 23, 2026

Growing highlighted fences now reuse settled line HTML and send only changed
lines to the browser. The 10,000-line case improves substantially, but still
stutters: reducing HTML parsing and DOM reconciliation does not eliminate the
cost of rendering the accumulated code block.

This is a focused before/after comparison within Pierre. It follows the
[HTML-addition optimization](./NON-ANIMATED.md); Streamdown, memory, and bundle
footprint were not remeasured. The large mixed-document demo is a different
workload and has not been rerun for this change.
[Raw runs, correctness checks, and bundle hashes](./results/2026-10-23-fences.json)
identify the measured builds.

The subsequent [full rerun](./CURRENT.md) also measures active-fence retained
heap and the mixed-document tradeoff.

## What changed

The live highlighter retains settled line HTML and returns a changed suffix,
plus lazy complete HTML for string consumers and fallback rendering. Extending a
partial code line also replaces the parser's synthetic final newline through a
live edit, avoiding a tokenizer reset.

For one top-level mutable fence, the DOM renderer keeps a comment at the start
of the final content line. Subsequent updates parse and patch the changed lines
after that boundary, leaving earlier nodes in place. Line numbers append as
text. This adds no per-line wrapper elements, node index, Markdown tree,
virtualization, or viewport policy.

Nested fences, HTML hooks, element filters, custom language renderers, skipped
updates, edits, and completion retain the complete-HTML fallback. The existing
string highlighter API remains available; the line-delta method is optional.
Unsupported languages and plugins implementing only the string API also use the
ordinary rendering path.

## Production browser results

Each cell is the median of three fresh-browser runs. Animation and code controls
are disabled. One TypeScript fence grows through 251 deliveries, alternating
complete and partial final lines. The 1,000-line fixture is 40 KB; the
10,000-line fixture is 416 KB. Deliveries contain approximately 4 or 40 lines
respectively, so these are capacity tests rather than fixed token-rate
simulations.

| Fence        | Line numbers | Update p95 before | Update p95 after | Replay before | Replay after |
| ------------ | ------------ | ----------------: | ---------------: | ------------: | -----------: |
| 1,000 lines  | On           |           13.5 ms |           0.4 ms |        2.35 s |       0.10 s |
| 1,000 lines  | Off          |           13.1 ms |           0.4 ms |        2.25 s |       0.09 s |
| 10,000 lines | On           |          122.5 ms |          18.5 ms |       23.93 s |       9.21 s |
| 10,000 lines | Off          |          120.8 ms |          18.5 ms |       21.62 s |       8.08 s |

The 10,000-line case with line numbers has about 85% lower p95 update time and a
62% shorter replay. Its median update is 2.4 ms, but the slower tail remains
material.

| 10,000-line browser responsiveness   |   Before |   After |
| ------------------------------------ | -------: | ------: |
| Frame interval p95, line numbers on  | 183.3 ms | 83.3 ms |
| Frame interval p95, line numbers off | 166.7 ms | 66.7 ms |
| Long tasks, line numbers on          |      199 |      41 |
| Long tasks, line numbers off         |      153 |      11 |

Separate diagnostic replays count template input rather than timing it. With
line numbers, HTML parsed falls from 51.67 MB to 0.85 MB at 1,000 lines and from
518.69 MB to 8.17 MB at 10,000 lines, approximately 98.4% less. Both
implementations retain the first settled highlighted span; the removed work is
repeated serialization, parsing, and traversal, rather than repeated mounting of
that span. Final element counts are unchanged.

### Paced streaming check

A separate single run per build inserts a 40 ms delay after each commit, with
10,000 lines and line numbers enabled. These are diagnostics, not three-run
medians.

| Paced replay       |   Before |   After |
| ------------------ | -------: | ------: |
| Update p95         | 120.7 ms | 18.8 ms |
| Frame interval p95 | 133.4 ms | 50.1 ms |
| Replay elapsed     |  26.16 s | 13.21 s |
| Long tasks         |      172 |      44 |

The improvement survives slower delivery. Frame pacing still misses a 60 Hz
budget, and the final full-fence patch can produce a large update.

## String-output replay

The Node formatter benchmark requests complete pending HTML and reads its length
on every update. Engines may defer copying concatenated strings; this does not
measure browser HTML parsing or DOM work. Values are medians of three timed
replays after a discarded warmup.

| Fence, line numbers on | Update p95 before | Update p95 after | Total before | Total after |
| ---------------------- | ----------------: | ---------------: | -----------: | ----------: |
| 1,000 lines            |           2.41 ms |          0.25 ms |       205 ms |       38 ms |
| 10,000 lines           |          24.03 ms |          2.59 ms |     2,069 ms |      353 ms |

Completed code text, including every newline, and line-number text match the
source in every replay. Node additionally checks highlighted structure and
visible-text styles against a fresh complete render. Equivalent adjacent spans,
entity spellings, trailing CSS semicolons, and the color assigned to line breaks
are normalized; byte-identical HTML is not required.

## Remaining costs and limits

The Markdown parser still processes the mutable fence and emits its complete
escaped body. Host code still checks the accumulated source prefix and decodes
that body. This change removes repeated highlighting, HTML parsing, and DOM
walking of settled lines; it does not make every stage proportional to the new
chunk.

The final 10,000-line output still contains 78,750 highlighted spans, with all
content in normal document layout. Browser rendering, line-number layout, and
the full completion patch remain candidates for profiling. No viewport
management was added to the library.

The highlighter already retained line HTML. It now also retains a settled HTML
prefix and lazy string results; the DOM renderer adds one active comment
boundary and reuses two templates. These observations are not heap-byte or
total-memory measurements, and unchanged final DOM counts do not establish an
unchanged peak memory cost.

## Method and reproduction

Production, minified React 19.2.7 bundles run in headless Chrome 156 at 1280×960
on macOS arm64, using Node 24.11.0. The baseline is the preceding uncommitted
HTML-addition implementation, frozen before this change. Measurements run
serially, with a distinct-code grammar warmup and a fresh empty renderer.

The main matrix uses separate MessageChannel tasks with no deliberate delay.
Commit time covers synchronous React work and native DOM patching; frame
intervals and long tasks also reflect subsequent browser work. Diagnostic
instrumentation runs separately. There is no animation, scrolling, containment,
or virtualization. No timing runs overlap tests or builds.

Use an isolated dependency directory containing esbuild and React, as for the
existing comparison harness:

```sh
moon run markdowns:bench-fence -- --deps=/tmp/markdowns-streamdown-setup-20261021/node_modules --output=/tmp/markdowns-fence-current --lines=1000,10000 --numbers=true,false --runs=3 --node-runs=3
moon run markdowns:bench-fence -- --deps=/tmp/markdowns-streamdown-setup-20261021/node_modules --output=/tmp/markdowns-fence-paced --lines=10000 --numbers=true --runs=1 --delay=40 --phases=browser --diagnostics=false
```

`--renderer-dir` selects a previously saved library dist. `--prepare-only`
freezes harness bundles; `--skip-build` reuses them. Raw results include bundle
hashes, all individual runs, correctness checks, and diagnostic counters.
