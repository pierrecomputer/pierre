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

A full headless run takes about 30 minutes. The memory values and the repeat
scenario take about 20 of them; `BENCH_MEMORY=0` skips them. Options come from
the environment:

| Variable            | Default            | Meaning                                                                  |
| ------------------- | ------------------ | ------------------------------------------------------------------------ |
| `BENCH_RUNS`        | `5`                | Measured runs for each scenario and parameter set.                       |
| `BENCH_WARMUP`      | `1`                | Runs before the measured runs. The report does not keep them.            |
| `BENCH_PANES`       | `4,16`             | Pane counts.                                                             |
| `BENCH_CONTENT`     | `light,heavy,real` | Content weights.                                                         |
| `BENCH_SCENARIOS`   | all                | A comma-separated list of scenario IDs.                                  |
| `BENCH_SAVE`        | `1`                | `0` writes the report to the output directory, not `results`.            |
| `BENCH_MODE`        | `headless`         | `headed` opens a browser window and measures frames at the display rate. |
| `BENCH_ATTRIBUTION` | `1`                | `0` skips the attribution run of each record.                            |
| `BENCH_MEMORY`      | `1`                | `0` skips the memory values and the repeat scenario.                     |
| `BENCH_QUERY`       | empty              | Fixture parameters that select a variant, for example `layers=off`.      |

For a quick trial that writes nothing to the repository:

```sh
BENCH_RUNS=1 BENCH_WARMUP=0 BENCH_SAVE=0 moon run layouts:bench
```

The fixture server uses port `4178` plus `PIERRE_PORT_OFFSET`. In a worktree
that the environment's manager created, set `PIERRE_PORT_OFFSET` to the
`WORKTREE_PORT_OFFSET` of `.env.worktree`.

Headless Chromium renders at 60 Hz. For frame metrics at the display rate, run a
headed pass on the reference Mac, with the window on the built-in display:

```sh
BENCH_MODE=headed BENCH_SCENARIOS=zoom,restore,zoom-busy,split,resize moon run layouts:bench
```

A headed report adds `-headed` to its file name, and a variant adds its
parameters, for example `-isolate-no-layer`.

## Fixture

`fixture/` renders a balanced split tree of `?panes=N` panes. The split
direction alternates at each depth. `?content=light` gives each pane a small
card. `?content=heavy` gives each pane one of four kinds of synthetic content,
in this order: a terminal (1,200 lines), a diff (800 rows), a file tree (1,200
nodes), and an agent chat (80 messages with wrapping text). A heavy pane holds
about 3,500 to 5,600 elements. `?content=real` uses real components in the same
order: xterm.js with its fit add-on (5,000 lines of scrollback, refit on each
resize), a highlighted split diff from `@pierre/diffs` (1,500 lines), a file
tree from `@pierre/trees` (5,000 paths, expanded), and the agent chat. Real
components do work of their own when a pane changes size, as they do in an app.

Each pane counts its own React renders and its `ResizeObserver` callbacks. An
editor or a terminal does real work in such a callback, so the count shows the
work that a layout operation pushes into content.

`window.__layoutsBench` exposes the store, the counters, `append(id)` to add
output to a pane, and `busy(ms)` to block the main thread.

`?layers=` sets the `paneLayers` option: `on`, `off`, or a number of visible
panes from which each pane host is its own compositor layer. Without it, the
option has its default, `{ minPanes: 6 }`.

`?isolate=` selects a variant of compositing: `layer` adds
`will-change: transform` to each pane host, which Chromium keeps at the raster
scale of its last animation (with `layers=off`, the pane layers from commit
`40389155` to the change to `translateZ(0)`). `contain` and `content-layer`
isolate the content area.

## Scenarios

| ID                 | Operation                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idle`             | Nothing. Shows the cost of the harness itself.                                                                                                        |
| `zoom`             | Click the zoom button of the first pane.                                                                                                              |
| `restore`          | Click the restore button of the zoomed first pane.                                                                                                    |
| `zoom-busy`        | Zoom, then block the main thread for 200 ms during the animation.                                                                                     |
| `focus`            | Click the content of the second pane.                                                                                                                 |
| `resize`           | Drag the root separator 160 px in 16 pointer moves.                                                                                                   |
| `split`            | Add a pane to the right of the first pane.                                                                                                            |
| `close`            | Click the close button of the second pane.                                                                                                            |
| `move`             | Move the first pane to the left of the last pane.                                                                                                     |
| `append`           | Append a message to the agent chat pane once per frame, 10 times.                                                                                     |
| `hidden-append`    | Zoom the first pane, then append to the covered agent chat pane 10 times.                                                                             |
| `hide`             | Hide the second pane with `store.setHidden`.                                                                                                          |
| `container-resize` | Narrow the viewport from 1440 px to 1200 px.                                                                                                          |
| `repeat`           | Not timed. Measures memory before and after 20 zooms and restores of the first pane and 20 hides and shows of the second pane. See [Memory](#memory). |

Each run loads a fresh page, runs the scenario's setup, waits two frames and 150
ms, and then traces the operation until the layout settles. With real content,
the run first waits 1.5 s for async work such as highlighting. Operations start
in a page task, not in `page.evaluate`, so that the CDP Performance domain
counts their script as script. The resize drag sends one pointer move per frame
interval.

## Metrics

Trace metrics count events on the main thread of the page's renderer.

| Metric                                                     | Source                                                                                                                                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mainThreadMs`, `longestTaskMs`                            | Top-level `RunTask` events.                                                                                                                                                       |
| `styleRecalcs`, `styleElements`, `styleMs`                 | `UpdateLayoutTree` events and their `elementCount`.                                                                                                                               |
| `layouts`, `layoutMs`                                      | `Layout` events.                                                                                                                                                                  |
| `forcedLayouts`                                            | `Layout` events with a stack trace: layouts that script forced.                                                                                                                   |
| `prePaintMs`, `paints`, `paintMs`, `layerizeMs`            | `PrePaint`, `Paint`, and `Layerize` events.                                                                                                                                       |
| `framesPresented`, `framesPartial`, `framesDropped`        | The state of each `PipelineReporter` frame of the page's compositor.                                                                                                              |
| `framesDroppedAfterFirst`                                  | Dropped frames after the first expected frame. A compositor animation needs one main-thread frame to start.                                                                       |
| `framesWithMainAnimation`, `framesWithCompositorAnimation` | The animation flags of each `PipelineReporter` frame.                                                                                                                             |
| `animations`, `animationsNotComposited`                    | `Animation` events, and the ones with a nonzero `compositeFailed` reason.                                                                                                         |
| `task*Ms`                                                  | `mainThreadMs` by kind of work: script, style, layout, pre-paint, paint, layerize, commit, GC, and other. Each event counts its self time, so the parts add up to `mainThreadMs`. |
| `cdp*`                                                     | Deltas of `Performance.getMetrics`, in counts and milliseconds.                                                                                                                   |
| `contentRenders`, `contentResizeCallbacks`                 | The fixture's counters.                                                                                                                                                           |

Use `layoutMs`, not a count of dirty objects, for layout cost. When a pane
changes width, Blink lays out its content without marking it dirty.

Each record also has `otherTasks`: the five largest event names of `taskOtherMs`
in the last run, for example the hit test and the text selection of a mouse
click.

## Attribution

After the timed runs, one more run of each record traces with invalidation
tracking, which names each element that the operation marks for style or layout.
The run finds the pane of each element through CDP, across shadow roots, and
counts the layers of the page from `LayerTree` events. The tracking slows the
run, so it gives no times. The record's `attribution` holds:

| Field                                                                 | Meaning                                                                                               |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `target`                                                              | The pane that the scenario changes, or null when it resizes several.                                  |
| `layoutInvalidations`, `styleInvalidations`                           | Elements in panes marked for layout or style.                                                         |
| `layoutInvalidationsOutsideTarget`, `styleInvalidationsOutsideTarget` | The same in other panes, pane hosts included.                                                         |
| `innerLayoutInvalidationsOutsideTarget`                               | Elements inside other panes marked for layout. A pane host that a zoom hides or shows does not count. |
| `layoutInvalidatedPanes`, `styleInvalidatedPanes`                     | Other panes with any invalidated element.                                                             |
| `unresolvedInvalidations`                                             | Elements that the operation removed before the run found their pane.                                  |
| `layers`, `drawingLayers`, `peakLayers`                               | Layers after the operation, the ones that draw content, and the most during it.                       |
| `panes`                                                               | Each pane's invalidated elements: layout, then style.                                                 |
| `outsideTarget`                                                       | The most common layout invalidations outside the target, as `reason: element`.                        |

A count of invalidated elements is not a cost: one invalidated pane host can lay
out all of its content. Read it with `taskLayoutMs` and `layoutMs`.

## Memory

After the attribution run of each record, the same page measures its memory, and
the record's `memory` holds the values. The run first reads the layers, then
waits until Chromium releases the raster resources that the operation stopped
using (about 5 s after an animation), then requests a detailed memory-infra dump
with `Tracing.requestMemoryDump`, which forces a garbage collection. The DOM
counters and the JS heap come after two forced garbage collections. The memory
run takes about 7 s for each record after an animation.

| Field                                               | Source                                                                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tileMemoryMb`                                      | The raster tiles that the page's compositor uses: the resources under `cc/tile_memory` of the page's renderer, less the ones with a `free_size` or a `busy_size`. |
| `tileMemoryVisibleMb`                               | The part of `tileMemoryMb` in visible tiles: the `cc/tile_manager_*/tile_*` entries with priority `NOW`. The rest is prepaint.                                    |
| `tileMemoryUnusedMb`                                | Resources that no tile used right after the operation. Chromium keeps them for reuse for about 5 s.                                                               |
| `rendererMb`, `gpuMb`                               | The private footprint of the page's renderer and of the GPU process. With GPU raster, the GPU process holds the tiles.                                            |
| `v8Mb`, `blinkGcMb`, `partitionAllocMb`, `mallocMb` | The allocators of the page's renderer.                                                                                                                            |
| `jsHeapMb`                                          | `Runtime.getHeapUsage`, after the garbage collections.                                                                                                            |
| `domNodes`, `jsEventListeners`                      | `Memory.getDOMCounters`, after the garbage collections.                                                                                                           |
| `layers`, `drawingLayers`                           | `LayerTree` events after the operation.                                                                                                                           |
| `estimatedRasterMb`                                 | The sum of the estimates of all layers that draw.                                                                                                                 |
| `panes`                                             | For each pane: its `layers`, `drawingLayers`, `estimatedRasterMb`, and `domNodes` (also in open shadow roots).                                                    |

The estimate of a layer is its area inside its pane's box and the viewport, in
the compositor's pixels, times 4 bytes. It is not the tile memory: Chromium
rounds each layer up to whole tiles, prepaints tiles near the viewport, and
stores no tile for an area of one color, such as the page background.

The `repeat` scenario runs once for each pane count and content weight. It does
one zoom and one hide first, so that memory that the first operation allocates
once does not count. Then it measures memory, does 20 zooms and restores and 20
hides and shows, and measures again. The report's `repeats` holds both values
and their difference (`growth`). At the end, the scenario zooms the first pane,
measures the tile memory, hides every other pane, and measures again: the
difference (`covered.tileMemoryMb`) is the raster memory that the covered panes
keep.

## Self-test

The first test runs on `fixture/selftest.html`: a transform animation, a `left`
animation, and a forced layout, with known trace counts. When a browser update
renames a trace field, this test fails, and the run does not report zeros. It
also checks that the `task*Ms` parts add up to `mainThreadMs`, and that
attribution keeps a text change in one pane inside that pane, and finds a font
size change above two panes in both. Chromium 134 writes frame data under
`chrome_frame_reporter`, and Chrome 155 under `frame_reporter`; the harness
reads both.

The second test adds four composited panes of 256 by 256 CSS pixels with a
gradient to the same page. The memory values must be above zero, the page must
have four more layers that draw, and the tile memory must grow by 0.75 to 1.5
times the estimate of the four layers. When Chromium renames a memory-infra
field, this test fails.

## Bundle size

Each run bundles each entry point on its own, with its imports and with React as
an external, through Vite (Rolldown and the Oxc minifier, Lightning CSS for the
stylesheet). The report's `bundle` section holds, for each entry point, the
minified bytes and the wire bytes after gzip (level 9, for reference), brotli
(quality 11), and Zstandard (level 19).

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
- `environment`: the browser, headless or headed, the refresh rate and the
  device scale that the page measured, the OS, the CPU, the viewport, and the
  run counts.
- `records`: one entry for each scenario and parameter set, with the `median` of
  each metric and every kept sample in `samples`, and the `attribution` and
  `memory` of the extra run.
- `repeats`: the repeat scenario at each parameter set.
- `checks`: the result of each check.
- `bundle`: the size of each entry point.

To compare two revisions, run the benchmark on each revision on the same
machine, and compare the medians of the two reports. Results from different
machines are not comparable. A new scenario starts its history when it is added;
to get earlier data, run it on an earlier revision.

## Limits

- Chromium only. Firefox and WebKit have no equivalent of these trace events in
  Playwright.
- Headless Chromium renders at 60 Hz. Its frame counts show relative change
  between revisions on one machine. Use a headed pass for the display rate.
- `mainThreadMs` includes the work of the harness, such as input dispatch and
  tracing. The `idle` scenario shows that floor.
- The content is synthetic. It has the DOM size of real content, but not its
  scripts.
- On the reference Mac, the headless compositor rasterizes at twice the CSS
  pixel size, although `devicePixelRatio` is 1, and with GPU raster. Memory
  values are for that scale. Compare them between revisions on one machine.
- Chromium 134 writes the tiles of each layer without the layer's name, so the
  memory of each pane is an estimate. The measured values cover the whole
  renderer.
