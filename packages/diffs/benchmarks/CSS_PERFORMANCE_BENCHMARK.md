# CSS Performance Benchmark

Use this runbook to compare scroll-time CSS/rendering performance between two
git SHAs in DiffsHub production mode.

The benchmark records Chrome performance traces while a fixed scroll driver
scrolls a large rendered diff. It is intended for CSS selector, layout,
containment, paint, and scrollbar changes.

## Requirements

Chrome trace capture is required. Prefer Chrome DevTools MCP for browser
navigation, stable-page checks, performance trace recording, page-script
execution, and trace export. Direct Chrome CDP or Playwright CDP is also
acceptable when DevTools MCP is unavailable or cannot export a trace reliably.

Use one trace tool and one browser mode for the whole benchmark. Do not mix
headed and headless traces, browser versions, trace categories, or profile/cache
treatment between SHAs.

## Choose The Mode

Use one mode for both SHAs.

Recommended for CSS-only investigations: isolated plain-text mode.

Temporarily disable async highlighting in both worktrees before building. This
reduces noise from syntax-highlight token spans and worker-highlight results, so
the trace is more focused on selector/layout/paint costs.

Use only when intentionally measuring full production behavior: highlighted
production mode.

Do not stub highlighting. This is closer to real user behavior, but small CSS
deltas are usually harder to detect because highlighting adds DOM and worker
noise.

## Inputs

Pick exact commits:

```bash
export BASE_SHA=<baseline-sha>
export TEST_SHA=<test-sha>
git rev-parse --short "$BASE_SHA"
git rev-parse --short "$TEST_SHA"
```

Use unique worktree slugs if rerunning the benchmark:

```bash
export BASE_SLUG=css-perf-base
export TEST_SLUG=css-perf-test
```

Put benchmark worktrees under the global temporary directory, not under the
home-directory Pierre worktree root:

```bash
export BENCHMARK_WORKTREE_ROOT=/tmp/pierre-css-benchmark-worktrees
export BASE_WORKTREE=$BENCHMARK_WORKTREE_ROOT/$BASE_SLUG
export TEST_WORKTREE=$BENCHMARK_WORKTREE_ROOT/$TEST_SLUG
```

This is appropriate for short-lived benchmark runs. Do not use `/tmp` for
long-lived worktrees because the OS or cleanup jobs may remove temporary files.

## Create Worktrees

Create two temporary worktrees from the repo root, then initialize Pierre's
worktree metadata in each one:

```bash
export AGENT=1
mkdir -p "$BENCHMARK_WORKTREE_ROOT"
git worktree add --detach "$BASE_WORKTREE" "$BASE_SHA"
git worktree add --detach "$TEST_WORKTREE" "$TEST_SHA"
```

```bash
cd "$BASE_WORKTREE"
export AGENT=1
bun run wt setup
```

```bash
cd "$TEST_WORKTREE"
export AGENT=1
bun run wt setup
```

`wt setup` writes each worktree's `.env.worktree`, installs dependencies, and
prints each worktree's port offset. DiffsHub runs on:

```text
3692 + PIERRE_PORT_OFFSET
```

Example:

```text
offset 20 -> http://localhost:3712
offset 30 -> http://localhost:3722
```

Record the two DiffsHub ports:

```bash
export BASE_PORT=<base-port>
export TEST_PORT=<test-port>
```

## Isolated Plain-Text Mode

Skip this section if measuring highlighted production mode.

Apply this same temporary edit in both worktrees:

```text
packages/diffs/src/worker/WorkerPoolManager.ts
```

Add an immediate `return;` at the start of these methods:

```text
highlightFileAST
primeFileHighlightCache
highlightDiffAST
primeDiffHighlightCache
```

Example:

```ts
public highlightDiffAST(
  instance: DiffRendererInstance,
  diff: FileDiffMetadata
): void {
  return;

  const cachedResult = this.getDiffResultCache(diff);
  // existing code continues...
}
```

Do not commit this patch. Revert it during cleanup.

## Build

Build both worktrees from their roots:

```bash
cd "$BASE_WORKTREE"
export AGENT=1
bun ws diffshub build
```

```bash
cd "$TEST_WORKTREE"
export AGENT=1
bun ws diffshub build
```

## Serve

Start each production server from its DiffsHub app directory:

```bash
cd "$BASE_WORKTREE/apps/diffshub"
nohup env AGENT=1 bun run start -- -p "$BASE_PORT" > /tmp/diffshub-base.log 2>&1 &
export BASE_SERVER_PID=$!
```

```bash
cd "$TEST_WORKTREE/apps/diffshub"
nohup env AGENT=1 bun run start -- -p "$TEST_PORT" > /tmp/diffshub-test.log 2>&1 &
export TEST_SERVER_PID=$!
```

Wait for both servers:

```bash
curl -fsS --retry 30 --retry-delay 1 "http://localhost:$BASE_PORT" > /dev/null
curl -fsS --retry 30 --retry-delay 1 "http://localhost:$TEST_PORT" > /dev/null
```

## Test Page

Use the same route for both SHAs. The route should be large enough to exercise
virtualized scrolling but stable before tracing starts.

Default route:

```text
/nodejs/oven-sh/bun/pull/30412
```

Before recording, wait until all of these are true:

```js
document.querySelector('.cv-scrollbar') instanceof HTMLElement;
document.querySelector('button[aria-label="Start autoscroll"]') instanceof
  HTMLElement;
!document.body.innerText.includes('STREAMING');
```

For highlighted production mode, also wait until worker/highlight stats appear
idle or have stopped changing long enough that highlight results are unlikely to
land during the trace.

## Record Traces

Use Chrome DevTools MCP, direct Chrome CDP, or Playwright CDP. Trace files must
include renderer-main events such as `UpdateLayoutTree` and `Layout`.

Use a fixed viewport for every run, for example `1440x1000`. Use the same
browser mode for every run. Record whether the browser was headed or headless.

Run one unrecorded warmup per SHA, then record at least three kept runs per SHA.
Use the same scroll driver for every warmup and kept run.

Recommended order:

```text
base-warmup
test-warmup
base-1
test-1
base-2
test-2
base-3
test-3
```

Do not record both SHAs concurrently. Alternating runs helps reduce drift from
cache state, JIT warmup, machine temperature, and background load. Warmup
results should satisfy the same scroll validation as kept runs, but should not
be included in the averages.

For each warmup:

1. Navigate to `http://localhost:<PORT><ROUTE>`.
2. Wait for the stable-page conditions above.
3. Execute one of the page scripts below without recording a trace.
4. Validate the returned scroll result, then discard it from the metric summary.

For each kept run:

1. Navigate to `http://localhost:<PORT><ROUTE>`.
2. Wait for the stable-page conditions above.
3. Start a performance trace with no reload.
4. Execute one of the page scripts below.
5. Stop and save the trace.
6. Save the returned scroll result with the trace filename.

If trace start, stop, export, or browser connection fails, discard that trace
and rerun it. Do not keep partial trace files from failed exports. If the
failure causes you to switch trace tools or browser mode, rerun the full set
with the new tool/mode so all kept traces are comparable.

For direct Chrome CDP, include at least these trace categories, joined with
commas:

```text
devtools.timeline
disabled-by-default-devtools.timeline
disabled-by-default-devtools.timeline.frame
toplevel
blink
cc
v8
```

Use a dedicated Chrome profile directory and disable background throttling when
running headless or in the background. For example, launch Chrome with
`--user-data-dir=<temp-dir>`, `--disable-background-timer-throttling`,
`--disable-backgrounding-occluded-windows`, and
`--disable-renderer-backgrounding`.

Recommended for CSS-only investigations: deterministic fixed-distance scroll.

This script avoids autoscroll timer/frame-rate drift by applying the same
`scrollTop` sequence in every trace. It drives the real `.cv-scrollbar` element,
which feeds the same renderer state as user scrolling. Do not dispatch synthetic
`scroll` events; they do not move browser scroll state and do not represent real
rendering work.

Pick a `targetScrollTop` that is safely below `scrollHeight - clientHeight` in
both SHAs. The default route currently supports `1_000_000`.

```js
async () => {
  const scroller = document.querySelector('.cv-scrollbar');
  if (!(scroller instanceof HTMLElement)) throw new Error('missing scroller');

  const pause = document.querySelector('button[aria-label="Pause autoscroll"]');
  if (pause instanceof HTMLElement) pause.click();

  const targetScrollTop = 1_000_000;
  const durationMs = 5_000;
  const steps = 300;
  const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
  if (targetScrollTop > maxScrollTop) {
    throw new Error(
      `targetScrollTop ${targetScrollTop} exceeds maxScrollTop ${maxScrollTop}`
    );
  }

  const nextFrame = () =>
    new Promise((resolve) => requestAnimationFrame(resolve));
  const previousScrollBehavior = scroller.style.scrollBehavior;
  scroller.style.scrollBehavior = 'auto';

  try {
    scroller.scrollTop = 0;
    await nextFrame();
    await nextFrame();

    const startTime = performance.now();
    let positionChecksum = 0;

    for (let step = 1; step <= steps; step++) {
      const targetTime = startTime + (durationMs * step) / steps;
      while (performance.now() < targetTime) {
        await nextFrame();
      }

      const expectedScrollTop = Math.round((targetScrollTop * step) / steps);
      scroller.scrollTop = expectedScrollTop;
      await nextFrame();

      const actualScrollTop = Math.round(scroller.scrollTop);
      if (actualScrollTop !== expectedScrollTop) {
        throw new Error(
          `scrollTop mismatch at step ${step}: expected ${expectedScrollTop}, got ${scroller.scrollTop}`
        );
      }
      positionChecksum += actualScrollTop * step;
    }

    await nextFrame();

    return {
      scrollTop: Math.round(scroller.scrollTop),
      targetScrollTop,
      durationMs: performance.now() - startTime,
      steps,
      positionChecksum,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    };
  } finally {
    scroller.style.scrollBehavior = previousScrollBehavior;
  }
};
```

For every kept trace, `scrollTop`, `targetScrollTop`, `steps`, and
`positionChecksum` should match across both SHAs. Rerun any trace that reports a
mismatch or throws.

Use this only when intentionally measuring product autoscroll behavior:

```js
async () => {
  const scroller = document.querySelector('.cv-scrollbar');
  if (!(scroller instanceof HTMLElement)) throw new Error('missing scroller');

  const pause = document.querySelector('button[aria-label="Pause autoscroll"]');
  if (pause instanceof HTMLElement) pause.click();

  scroller.scrollTop = 0;
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );

  const start = document.querySelector('button[aria-label="Start autoscroll"]');
  if (!(start instanceof HTMLElement)) {
    throw new Error('missing autoscroll start');
  }

  start.click();
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const stop = document.querySelector('button[aria-label="Pause autoscroll"]');
  if (stop instanceof HTMLElement) stop.click();

  return {
    scrollTop: scroller.scrollTop,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
  };
};
```

Suggested trace names:

```text
/tmp/diffshub-traces/base-1.json
/tmp/diffshub-traces/base-2.json
/tmp/diffshub-traces/base-3.json
/tmp/diffshub-traces/test-1.json
/tmp/diffshub-traces/test-2.json
/tmp/diffshub-traces/test-3.json
```

## Analyze Traces

Update `dir` and filenames as needed:

```bash
bun -e '
const fs = require("fs");

const dir = "/tmp/diffshub-traces";
const groups = {
  base: ["base-1.json", "base-2.json", "base-3.json"],
  test: ["test-1.json", "test-2.json", "test-3.json"],
};

const metrics = [
  "UpdateLayoutTree",
  "Layout",
  "PrePaint",
  "Paint",
  "PaintImage",
  "Layerize",
  "UpdateLayer",
  "ScrollLayer",
  "Commit",
  "RunTask",
  "FunctionCall",
  "EventDispatch",
  "FireAnimationFrame",
  "ParseHTML",
];

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function round(value) {
  return +value.toFixed(2);
}

function summarizeValues(values) {
  return {
    average: round(average(values)),
    median: round(median(values)),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

function summarizeTrace(file) {
  const data = JSON.parse(fs.readFileSync(`${dir}/${file}`, "utf8"));
  const events = data.traceEvents || data;
  const threads = new Map();

  for (const event of events) {
    if (event.ph === "M" && event.name === "thread_name") {
      threads.set(`${event.pid}:${event.tid}`, event.args?.name);
    }
  }

  const totals = Object.fromEntries(metrics.map((metric) => [metric, 0]));
  for (const event of events) {
    if (event.ph !== "X" || !metrics.includes(event.name)) continue;
    if (threads.get(`${event.pid}:${event.tid}`) !== "CrRendererMain") continue;
    totals[event.name] += (event.dur || 0) / 1000;
  }

  return totals;
}

function summarizeRun(file) {
  const row = summarizeTrace(file);
  const paintComposite =
    row.PrePaint +
    row.Paint +
    row.PaintImage +
    row.Layerize +
    row.UpdateLayer +
    row.ScrollLayer +
    row.Commit;

  return {
    file,
    updateLayoutTree: row.UpdateLayoutTree,
    layout: row.Layout,
    styleLayout: row.UpdateLayoutTree + row.Layout,
    paintComposite,
  };
}

function summarizeGroup(files) {
  const runs = files.map(summarizeRun);

  return {
    runs: runs.map((run) => ({
      file: run.file,
      updateLayoutTree: round(run.updateLayoutTree),
      layout: round(run.layout),
      styleLayout: round(run.styleLayout),
      paintComposite: round(run.paintComposite),
    })),
    summary: {
      updateLayoutTree: summarizeValues(
        runs.map((run) => run.updateLayoutTree)
      ),
      layout: summarizeValues(runs.map((run) => run.layout)),
      styleLayout: summarizeValues(runs.map((run) => run.styleLayout)),
      paintComposite: summarizeValues(runs.map((run) => run.paintComposite)),
    },
  };
}

for (const [label, files] of Object.entries(groups)) {
  console.log(label, JSON.stringify(summarizeGroup(files), null, 2));
}
'
```

With the deterministic fixed-distance scroll driver, the kept runs should have
the same `scrollTop`, `targetScrollTop`, `steps`, and `positionChecksum`. If you
use product autoscroll or any other driver where scroll distances differ,
normalize each run before averaging:

```text
metric_ms_per_million_px = metric_ms / (scrollTop / 1_000_000)
```

## Report Results

Include:

- `BASE_SHA` and `TEST_SHA`
- route
- viewport
- trace tool used: Chrome DevTools MCP, direct Chrome CDP, or Playwright CDP
- browser mode: headed or headless
- mode: isolated plain-text or highlighted production
- scroll driver: deterministic fixed-distance or product autoscroll
- run order and warmup policy
- number of runs and seconds per run, or returned `durationMs` for
  fixed-distance runs
- `targetScrollTop`, `steps`, and `positionChecksum` for fixed-distance runs
- average scroll distance per SHA
- per-run raw metrics
- raw metric average, median, min, and max
- normalized metric averages when scroll distances differ
- dropped traces or trace collection issues

Treat small deltas cautiously. Browser traces are noisy. For highlighted
production mode, sub-1% deltas are usually inconclusive unless they reproduce
over more runs.

## Cleanup

Stop servers:

```bash
kill "$BASE_SERVER_PID" "$TEST_SERVER_PID"
```

Remove worktrees:

```bash
cd <main-repo-root>
bun run wt rm "$BASE_SLUG" --force
bun run wt rm "$TEST_SLUG" --force
rmdir "$BENCHMARK_WORKTREE_ROOT" 2>/dev/null || true
```

If isolated plain-text mode was used, make sure any temporary highlight stubs
are gone from any remaining working tree.

Confirm final state:

```bash
git status --short
bun run wt ps
```
