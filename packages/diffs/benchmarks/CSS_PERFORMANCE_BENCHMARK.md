# CSS Performance Benchmark

Use this runbook to compare scroll-time CSS/rendering performance between two
git SHAs in DiffsHub production mode.

The benchmark records Chrome performance traces while DiffsHub's autoscroll
button scrolls a large rendered diff. It is intended for CSS selector, layout,
containment, paint, and scrollbar changes.

## Requirements

Chrome DevTools MCP is required. Use it for browser navigation, stable-page
checks, performance trace recording, page-script execution, and trace export.

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

## Create Worktrees

Create two temporary Pierre-managed worktrees from the repo root:

```bash
export AGENT=1
bun run wt new "$BASE_SLUG" --base "$BASE_SHA"
bun run wt new "$TEST_SLUG" --base "$TEST_SHA"
```

The helper prints each worktree's port offset. DiffsHub runs on:

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
cd ~/pierre/pierre-worktrees/$BASE_SLUG
export AGENT=1
bun ws diffshub build
```

```bash
cd ~/pierre/pierre-worktrees/$TEST_SLUG
export AGENT=1
bun ws diffshub build
```

## Serve

Start each production server from its DiffsHub app directory:

```bash
cd ~/pierre/pierre-worktrees/$BASE_SLUG/apps/diffshub
nohup env AGENT=1 bun run start -- -p "$BASE_PORT" > /tmp/diffshub-base.log 2>&1 &
export BASE_SERVER_PID=$!
```

```bash
cd ~/pierre/pierre-worktrees/$TEST_SLUG/apps/diffshub
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

Use Chrome DevTools MCP. Trace files must include renderer-main events such as
`UpdateLayoutTree` and `Layout`.

Use a fixed viewport for every run, for example `1440x1000`.

Record at least three 5-second runs per SHA.

For each run:

1. Navigate to `http://localhost:<PORT><ROUTE>`.
2. Wait for the stable-page conditions above.
3. Start a performance trace with no reload.
4. Execute this page script.
5. Save the returned `scrollTop` with the trace filename.
6. Stop and save the trace.

Page script:

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

function round(value) {
  return +value.toFixed(2);
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

function summarizeGroup(files) {
  const rows = files.map(summarizeTrace);
  const updateLayoutTree = average(rows.map((row) => row.UpdateLayoutTree));
  const layout = average(rows.map((row) => row.Layout));
  const paintComposite = average(
    rows.map(
      (row) =>
        row.PrePaint +
        row.Paint +
        row.PaintImage +
        row.Layerize +
        row.UpdateLayer +
        row.ScrollLayer +
        row.Commit
    )
  );

  return {
    updateLayoutTree,
    layout,
    styleLayout: updateLayoutTree + layout,
    paintComposite,
  };
}

for (const [label, files] of Object.entries(groups)) {
  const summary = summarizeGroup(files);
  console.log(label, {
    updateLayoutTree: round(summary.updateLayoutTree),
    layout: round(summary.layout),
    styleLayout: round(summary.styleLayout),
    paintComposite: round(summary.paintComposite),
  });
}
'
```

If scroll distances differ, normalize each run before averaging:

```text
metric_ms_per_million_px = metric_ms / (scrollTop / 1_000_000)
```

## Report Results

Include:

- `BASE_SHA` and `TEST_SHA`
- route
- viewport
- trace tool used: Chrome DevTools MCP or Playwright CDP
- mode: isolated plain-text or highlighted production
- number of runs and seconds per run
- average scroll distance per SHA
- raw metric averages
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
```

If isolated plain-text mode was used, make sure any temporary highlight stubs
are gone from any remaining working tree.

Confirm final state:

```bash
git status --short
bun run wt ps
```
