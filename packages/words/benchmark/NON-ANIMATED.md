# Non-animated large-document improvements — October 22, 2026

Subsequent scope decision: viewport management belongs to consuming UI
libraries. The grouping experiments below remain benchmark-only. The next
library change targets [mutable code fences](./FENCES.md).

Passing completed HTML additions between layers reduces update work
substantially. The 1,000× case still stutters because maintaining the
accumulated browser document remains expensive. Grouped offscreen rendering
resolves that frame problem in the prototype, but needs a different insertion
strategy before it can become library behavior.

[Raw runs and bundle hashes](./results/2026-10-22-non-animated.json) accompany
this focused follow-up to [the full benchmark report](./CURRENT.md). Animation
is disabled throughout. This is an implementation comparison within Pierre;
Streamdown, memory, and transfer footprint were not remeasured here.

## Implemented: consume HTML additions directly

The parser and formatter now expose newly completed `addition` strings and an
increasing `revision`. The DOM renderer consumes additions directly, avoiding
two growing-prefix comparisons and slices. Complete `.html` output is assembled
lazily when requested. Source-prefix checking remains necessary to detect edits
in the accumulated-string API.

Initial markup, replacement edits, configuration changes, and skipped revisions
recover from complete stable HTML. Failed trusted hooks clear partial formatting
state so retrying cannot return stale output. The change adds no Markdown tree
or per-node state.

The following are medians of three production browser replays per scale/build.
Both builds receive the same 267 updates and produce matching paragraph/code
text, all expected highlighted fences, and no retained fade wrappers.

| Highlighted, without animation |   Before | HTML additions |
| ------------------------------ | -------: | -------------: |
| 100× update p95                |   4.9 ms |         2.4 ms |
| 100× settled replay            |  12.61 s |        11.89 s |
| 100× frame p95                 |  16.7 ms |        16.8 ms |
| 1,000× update p95              |  30.3 ms |         6.4 ms |
| 1,000× settled replay          |  32.88 s |        24.94 s |
| 1,000× frame p95               | 116.7 ms |       116.6 ms |

That is approximately 79% lower update latency and 24% shorter replay at 1,000×.
The unchanged frame pacing is a material limit: reducing JavaScript update work
alone has not made the giant case smooth.

## Experiments: reduce offscreen browser work

These policies exist only in the benchmark harness. Each row below is one
diagnostic run on the updated renderer at 1,000×, keeping the viewport at the
top.

| Experimental policy                     | Update p95 | Frame p95 | Settled replay | Long tasks |
| --------------------------------------- | ---------: | --------: | -------------: | ---------: |
| No containment                          |     6.2 ms |  116.7 ms |        25.09 s |        171 |
| Completed code wrappers                 |     6.4 ms |  100.1 ms |        23.97 s |        156 |
| Code wrappers and individual paragraphs |    10.0 ms |  133.3 ms |        29.33 s |        167 |
| Groups of completed blocks              |    11.8 ms |   16.7 ms |        13.71 s |          0 |

The grouping prototype puts up to 128 completed top-level elements into a
section and applies `content-visibility: auto` with an estimated intrinsic
height. The mutable suffix stays outside these sections. The final document
still contains the original 889,281 elements plus 885 section wrappers; this
reduces rendering work, not DOM storage.

Height estimates matter. With the default 2,000px estimate, the fixed-top
grouped document reports a scroll height of 1.78 million px, versus 5.79 million
without containment. A separate 6,000px sensitivity run reports 5.31 million px
while retaining 16.7 ms p95 frames, zero long tasks, and a 13.56-second replay.
The performance benefit therefore persists with a much larger scroll range, but
neither estimate establishes equivalent geometry for arbitrary content.

## Following the stream

The demo follows content inside a 640px scroller. Reading its `scrollHeight`
inside a layout effect can force layout immediately after Markdown DOM writes.
The harness now tests that behavior and a single `ResizeObserver` on the
rendered root.

| 1,000× follow behavior                        | Runs | Update p95 | Frame p95 | Settled replay | Long tasks |
| --------------------------------------------- | ---: | ---------: | --------: | -------------: | ---------: |
| Current layout-effect scroll, no containment  |    1 |   108.2 ms |  116.7 ms |        35.54 s |        215 |
| ResizeObserver scroll, no containment         |    1 |     6.4 ms |  133.4 ms |        28.81 s |        183 |
| Current layout-effect scroll, grouped content |    3 |     9.0 ms |   16.7 ms |        13.70 s |          0 |
| ResizeObserver scroll, grouped content        |    1 |     7.8 ms |   16.7 ms |        13.67 s |          0 |

The three-run row gives medians; the other rows are diagnostics. Every followed
run ends at the bottom. ResizeObserver scrolling occurs after commit timing, so
its lower update p95 does not establish equivalent responsiveness: frames and
long tasks still show stutter without containment. The existing demo scrolling
code remains intact.

Grouping also changes scroll geometry while following. Final heights are 3.83
million px with layout-effect scrolling and 5.39 million with ResizeObserver,
versus 5.79 million without containment. Semantic hashes match, but they do not
establish matching margins, scrolling, selection, or accessibility behavior.

## Next implementation direction

Create permanent sections as new content is inserted, rather than moving
existing paragraphs into groups. A real-browser probe showed that reparenting a
selected paragraph clears its native selection; using the browser's
`moveBefore()` method also cleared it in the tested Chrome build. The prototype
is deliberately not part of the library, and no custom selection handling has
been introduced.

The next version needs to preserve existing nodes in place, handle first render
and replacement edits, and validate scroll anchoring, native selection, search,
custom HTML hooks, and margins. The results support this direction but do not
yet justify enabling it by default.

## Method and reproduction

Same stress fixture and production React/browser setup as CURRENT.md: 0.85 MB
and 8.53 MB, 3,200/32,000 characters per delivery, and a 40ms commit-paced
delay. Code controls and line numbers are disabled. Timing excludes tracing and
DOM sampling. These are capacity tests, not a fixed token-rate simulation or
low-powered-device result. Parser/highlighter warmup precedes a fresh empty
renderer. Browser runs are isolated and serial.

```sh
moon run markdowns:bench-render-compare -- --deps=/tmp/markdowns-streamdown-setup-20261021/node_modules --output=/tmp/markdowns-additions --libraries=pierre --scales=100,1000 --modes=highlight --runs=3
moon run markdowns:bench-render-compare -- --deps=/tmp/markdowns-streamdown-setup-20261021/node_modules --output=/tmp/markdowns-sections --libraries=pierre --scales=1000 --modes=highlight --runs=3 --containment=sections --scroll=layout
moon run markdowns:bench-render-compare -- --deps=/tmp/markdowns-streamdown-setup-20261021/node_modules --output=/tmp/markdowns-height-check --libraries=pierre --scales=1000 --modes=highlight --runs=1 --containment=sections --section-height=6000
```

Other diagnostic policies are `--containment=code` and `--containment=blocks`;
scroll modes are `top`, `layout`, and `resize`. Visibility policies affect only
Pierre. The default harness retains the original rendering behavior.
