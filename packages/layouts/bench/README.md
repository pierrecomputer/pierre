# Layout benchmarks

This harness measures `@pierre/layouts` against its performance baseline. It
runs user operations on a production build of a fixture page in Chromium,
records a Chrome trace and the CDP Performance counters for each operation, and
writes a JSON report to `bench/results/`. Commit each report with the code that
it measures, so that the history shows how performance changes over time.

## Run

From anywhere in the repository:

```sh
moon run layouts:bench
```

A full run takes about five minutes. Options come from the environment:

| Variable          | Default       | Meaning                                                       |
| ----------------- | ------------- | ------------------------------------------------------------- |
| `BENCH_RUNS`      | `5`           | Measured runs for each scenario and parameter set.            |
| `BENCH_WARMUP`    | `1`           | Runs before the measured runs. The report does not keep them. |
| `BENCH_PANES`     | `4,16`        | Pane counts.                                                  |
| `BENCH_CONTENT`   | `light,heavy` | Content weights.                                              |
| `BENCH_SCENARIOS` | all           | A comma-separated list of scenario IDs.                       |
| `BENCH_SAVE`      | `1`           | `0` writes the report to the output directory, not `results`. |

For a quick trial that writes nothing to the repository:

```sh
BENCH_RUNS=1 BENCH_WARMUP=0 BENCH_SAVE=0 moon run layouts:bench
```

The fixture server uses port `4178` plus `PIERRE_PORT_OFFSET`.

## Fixture

`fixture/` renders a balanced split tree of `?panes=N` panes. The split
direction alternates at each depth. `?content=light` gives each pane a small
card. `?content=heavy` gives each pane one of four kinds of synthetic content,
in this order: a terminal (1,200 lines), a diff (800 rows), a file tree (1,200
nodes), and an agent chat (80 messages with wrapping text). A heavy pane holds
about 3,500 to 5,600 elements.

Each pane counts its own React renders and its `ResizeObserver` callbacks. An
editor or a terminal does real work in such a callback, so the count shows the
work that a layout operation pushes into content.

`window.__layoutsBench` exposes the store, the counters, `append(id)` to add
output to a pane, and `busy(ms)` to block the main thread.

## Scenarios

| ID                 | Operation                                                                 |
| ------------------ | ------------------------------------------------------------------------- |
| `idle`             | Nothing. Shows the cost of the harness itself.                            |
| `zoom`             | Click the zoom button of the first pane.                                  |
| `restore`          | Click the restore button of the zoomed first pane.                        |
| `zoom-busy`        | Zoom, then block the main thread for 200 ms during the animation.         |
| `focus`            | Click the content of the second pane.                                     |
| `resize`           | Drag the root separator 160 px in 16 pointer moves.                       |
| `split`            | Add a pane to the right of the first pane.                                |
| `close`            | Click the close button of the second pane.                                |
| `move`             | Move the first pane to the left of the last pane.                         |
| `append`           | Append a message to the agent chat pane once per frame, 10 times.         |
| `hidden-append`    | Zoom the first pane, then append to the covered agent chat pane 10 times. |
| `container-resize` | Narrow the viewport from 1440 px to 1200 px.                              |

Each run loads a fresh page, runs the scenario's setup, waits two frames and 150
ms, and then traces the operation until the layout settles.

## Metrics

Trace metrics count events on the main thread of the page's renderer.

| Metric                                                     | Source                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `mainThreadMs`, `longestTaskMs`                            | Top-level `RunTask` events.                                          |
| `styleRecalcs`, `styleElements`, `styleMs`                 | `UpdateLayoutTree` events and their `elementCount`.                  |
| `layouts`, `layoutMs`                                      | `Layout` events.                                                     |
| `prePaintMs`, `paints`, `paintMs`, `layerizeMs`            | `PrePaint`, `Paint`, and `Layerize` events.                          |
| `framesPresented`, `framesPartial`, `framesDropped`        | The state of each `PipelineReporter` frame of the page's compositor. |
| `framesWithMainAnimation`, `framesWithCompositorAnimation` | The animation flags of each `PipelineReporter` frame.                |
| `animations`, `animationsNotComposited`                    | `Animation` events, and the ones with a `compositeFailed` reason.    |
| `cdp*`                                                     | Deltas of `Performance.getMetrics`, in counts and milliseconds.      |
| `contentRenders`, `contentResizeCallbacks`                 | The fixture's counters.                                              |

Use `layoutMs`, not a count of dirty objects, for layout cost. When a pane
changes width, Blink lays out its content without marking it dirty.

## Checks

`lib/checks.ts` maps each rule of the baseline in the `pierre-layouts` intent to
one or more checks on the medians. The run prints a table of the checks, and the
report holds them. A check that compares two parameter sets, for example heavy
over light content, passes when the ratio is at most 1.25.

## Report

`results/<date>-<commit>.json` holds:

- `schema`: the version of this shape, now `1`.
- `commit`: the SHA, the branch, and `dirty` when the package had uncommitted
  changes. A dirty report adds `-dirty` to its file name.
- `environment`: the browser, the OS, the CPU, the viewport, and the run counts.
- `records`: one entry for each scenario and parameter set, with the `median` of
  each metric and every kept sample in `samples`.
- `checks`: the result of each check.

To compare two revisions, run the benchmark on each revision on the same
machine, and compare the medians of the two reports. Results from different
machines are not comparable. A new scenario starts its history when it is added;
to get earlier data, run it on an earlier revision.

## Limits

- Chromium only. Firefox and WebKit have no equivalent of these trace events in
  Playwright.
- Headless Chromium has no display. Frame counts show relative change between
  revisions on one machine, not the frame rate of a real display.
- `mainThreadMs` includes the work of the harness, such as input dispatch and
  tracing. The `idle` scenario shows that floor.
- The content is synthetic. It has the DOM size of real content, but not its
  scripts.
