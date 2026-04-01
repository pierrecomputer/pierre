# @pierre/trees

File tree UI built on `@headless-tree/core`, shipped as:

- A Shadow DOM custom element (`<file-tree-container>`)
- An imperative JS API (`new FileTree(...)`)
- A React wrapper (client component) for controlled/uncontrolled state

The component is styled via CSS custom properties and encapsulates styles inside
its shadow root (SSR and CSR).

## Install

```bash
bun add @pierre/trees
```

## Vanilla Usage

```ts
import { FileTree } from '@pierre/trees';

const ft = new FileTree({
  initialFiles: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
  flattenEmptyDirectories: true,
  useLazyDataLoader: true,
});

ft.render({ containerWrapper: document.getElementById('mount')! });
```

To clean up:

```ts
ft.cleanUp();
```

## React Usage (Client)

```tsx
'use client';

import { FileTree } from '@pierre/trees/react';

export function Example({ files }: { files: string[] }) {
  return (
    <FileTree
      options={{ flattenEmptyDirectories: true }}
      files={files}
      initialExpandedItems={['src']}
      onExpandedItemsChange={(paths) => {
        console.log('expanded', paths);
      }}
    />
  );
}
```

## Header And Context Menu Slots

The tree can expose extension points in light DOM:

- `slot="header"` for custom header UI
- `slot="context-menu"` for custom context menu UI

You can import slot names from `@pierre/trees`:

```ts
import { CONTEXT_MENU_SLOT_NAME, HEADER_SLOT_NAME } from '@pierre/trees';
```

### Vanilla context menu

Provide `onContextMenuOpen` and render your own menu into `slot="context-menu"`
(for example shadcn, react-aria, or any custom menu).

```ts
import { CONTEXT_MENU_SLOT_NAME, FileTree } from '@pierre/trees';

const host = document.getElementById('tree') as HTMLElement;
const slot = document.createElement('div');
slot.setAttribute('slot', CONTEXT_MENU_SLOT_NAME);
host.appendChild(slot);

const fileTree = new FileTree(
  { initialFiles: ['README.md', 'src/index.ts'] },
  {
    onContextMenuOpen: (item, context) => {
      slot.textContent = `${item.path}`;
      // context.anchorElement / context.anchorRect are provided for positioning.
      // context.close() should be called when your menu closes.
    },
    onContextMenuClose: () => {
      slot.textContent = '';
    },
  }
);
```

### React context menu

Use `renderContextMenu` on the React wrapper to render into the context-menu
slot. The callback receives the same `item` and `context`.

```tsx
import { FileTree } from '@pierre/trees/react';

<FileTree
  options={{}}
  initialFiles={['README.md', 'src/index.ts']}
  renderContextMenu={(item, context) => (
    <MyMenu
      item={item}
      anchor={context.anchorElement}
      onClose={context.close}
    />
  )}
/>;
```

## Files API Contract

- Paths use forward slashes. End a path with `/` to create an explicit directory
  entry, including an empty folder.
- `initialFiles` is the uncontrolled initial value and is only used when a tree
  instance is created.
- React controlled usage should pass `files` and keep parent state
  authoritative.
- `onFilesChange` fires when files are applied via:
  - `fileTree.setFiles(nextFiles)`
  - `fileTree.setOptions(..., { files: nextFiles })` (including when structural
    options are changed in the same call)
- `onFilesChange` does not fire for a no-op update where the exact same array
  reference is provided.
- In controlled React mode, use identity-preserving updates in the callback to
  avoid loops:

```tsx
onFilesChange={(nextFiles) => setFiles((prev) => (prev === nextFiles ? prev : nextFiles))}
```

## SSR With Declarative Shadow DOM (No Flash)

To avoid a flash of unstyled content (FOUC), SSR should inline the component's
styles in the shadow root. Declarative Shadow DOM is the intended path.

### 1) Server: generate shadow-root HTML

```tsx
import { preloadFileTree } from '@pierre/trees/ssr';

export function FileTreeSsr({ files }: { files: string[] }) {
  const payload = preloadFileTree({
    initialFiles: files,
    flattenEmptyDirectories: true,
    useLazyDataLoader: true,
  });

  return (
    <div
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: payload.html }}
    />
  );
}
```

### 2) Client: hydrate the existing element

With React:

```tsx
'use client';

import { FileTree } from '@pierre/trees/react';

export function FileTreeHydrate({
  id,
  files,
}: {
  id: string;
  files: string[];
}) {
  return <FileTree containerId={id} options={{}} files={files} />;
}
```

Or with the imperative API:

```ts
import { FileTree } from '@pierre/trees';

const ft = new FileTree({ initialFiles: files });
ft.hydrate({ fileTreeContainer: document.getElementById(id)! });
```

## Styling

The custom element exposes CSS variables (e.g. `--trees-font-family-override`,
`--trees-border-color-override`) that are read inside the shadow root.

## Development

From `packages/trees`:

```bash
bun test
bun run benchmark
bun run benchmark:core
bun run benchmark:render
bun run test:e2e
bun run tsc
bun run build
```

Testing policy and E2E guidance:

- `test/TESTING.md`

## Benchmarking

The `trees` package includes a dedicated `fileListToTree` benchmark runner:

```bash
bun ws trees benchmark
```

Use `--case` to focus on a subset while iterating locally:

```bash
bun ws trees benchmark -- --case=deep
bun ws trees benchmark -- --case=linux --runs=10 --warmup-runs=2
```

The default suite mixes synthetic shapes with two real fixtures so changes are
measured against both controlled and realistic inputs:

- `tiny-flat`, `small-mixed`, `medium-balanced`, `large-wide`,
  `large-deep-chain`, `large-monorepo-shaped`, and `explicit-directories`
- `fixture-linux-kernel-files`, loaded from `@pierre/tree-test-data`
- `fixture-pierrejs-repo-snapshot`, loaded from `@pierre/tree-test-data`

The benchmark records:

- end-to-end `fileListToTree` timing
- stage timings for `buildPathGraph`, `buildFlattenedNodes`, `buildFolderNodes`,
  and `hashTreeKeys`
- a deterministic checksum per case so behavior changes are visible alongside
  timing changes

Use `--json` when you want machine-readable output or a saved baseline:

```bash
bun ws trees benchmark -- --json > tmp/fileListToTree-baseline.json
```

Use `--compare` to run the current code against a saved JSON baseline:

```bash
bun ws trees benchmark -- --compare tmp/fileListToTree-baseline.json
bun ws trees benchmark -- --case=linux --compare tmp/fileListToTree-baseline.json --json
```

`--compare` matches cases by name, reports median deltas, and flags checksum
mismatches. That makes it useful both for performance regressions and for
catching accidental behavior changes while refactoring.

For core tree primitive profiling, use the dedicated benchmark runner:

```bash
bun ws trees benchmark:core
```

If you care most about large datasets, run a filtered large-shape subset:

```bash
bun ws trees benchmark:core -- --case=large-wide --case=large-monorepo --case=linux
```

This benchmark isolates core tree costs by preparing fixture-backed tree data up
front and timing only primitive calls. The `createTree` timing reflects the real
initialization path (`createTree` + `setMounted(true)` + initial `rebuildTree`).
`rebuildTree` can run either as unchanged hot rebuilds or as changed-state
rebuilds via `--rebuild-mode=expanded-copy`.

To better mirror the trees-dev virtualization workload, benchmark cases are
built with `sort: false` and `flattenEmptyDirectories: true`.

It also supports `--json`, `--compare`, and `--case` filters, plus:

- `--create-iterations` to batch multiple create+mount+initial-rebuild calls per
  measured sample
- `--rebuild-iterations` to batch multiple `rebuildTree` calls per measured
  sample
- `--rebuild-mode` to choose unchanged rebuilds or a changed-state mode
  (`expanded-copy`) with stronger update-path signal
- `--feature-profile` to switch between `virtualized-card` realism,
  `root-default`, and `minimal` core-only feature overhead

Those batching flags improve confidence for fast operations by reducing timer
jitter while still reporting per-call milliseconds.

For an end-to-end view of the virtualized Linux file-tree render path, use the
dedicated render benchmark:

```bash
bun ws trees benchmark:render
```

By default this benchmark runs only the Linux kernel fixture with all folders
expanded, matching the trees-dev virtualization workload while keeping the
virtualizer itself out of scope. The runner rebuilds `dist/` first and then
measures the production bundle with a benchmark-local static window adapter. It
still exercises the full render pipeline:

- `new FileTree(...)`
- `fileListToTree(...)`
- core tree creation through the same built hooks and features that power `Root`
- SSR rendering of a fixed first window (30 rows by default) through the built
  `TreeItem` path

The fixed window avoids the misleading cost of serializing ~93k rows to HTML
while still forcing the tree to process the full dataset before deciding which
items to render.

No baseline is required for normal runs. `--compare` is optional and only used
when you want to validate a saved baseline.

Useful flags:

- `--window-size` to change the simulated visible row count
- `--window-start` to benchmark a later virtualized slice
- `--case` to run a different fixture or synthetic shape while iterating
- `--json` and `--compare` for saved baselines and regression checks

For a real Chrome trace of the virtualization click-to-render workload, use the
dedicated profiler command:

```bash
bun ws trees profile:virtualization
```

This command is separate from Playwright. It uses a minimal Vite fixture page at
`http://127.0.0.1:9221/test/e2e/fixtures/virtualization.html` and connects to a
real Chrome instance over the DevTools remote debugging port
`http://127.0.0.1:9222`.

Before running it, start Chrome manually with remote debugging enabled. For
example:

```bash
/Applications/Google\ Chrome\ Dev.app/Contents/MacOS/Google\ Chrome\ Dev \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-devtools-codex
```

By default the command:

- rebuilds `@pierre/trees`
- reuses the fixture server if it is already running on `127.0.0.1:9221`
- otherwise starts the fixture server itself
- opens the virtualization fixture in Chrome
- clicks `Render`
- captures both a Chrome trace and a sampled CPU profile for that render

The human-readable output includes:

- per-run render timing
- visible-rows-ready and post-paint-ready timing
- click-dispatch and click-to-render timing
- trace-window timing, busy time, and coarse render buckets
- nested phase tables with `Total` and `Own` time for the major subsystems and
  tree-build stages
- workload counters beside those phase timings
- a bottom-up sampled CPU table with `self` and `total` time
- optional function invocation counts from an auxiliary precise-coverage pass

An optional dominant-trace-events table can also be shown with a flag, but it is
lower signal than the phase and bottom-up CPU sections and is hidden by default.

Fixture workloads:

- `pierre-snapshot`
- `half-linux`
- `linux`
- `linux-5x` (default)
- `linux-10x`

These let the same real-Chrome interaction be measured across a small
representative repo snapshot, a lighter Linux slice, the base Linux fixture, and
the larger replicated worst-case trees.

Useful examples:

```bash
# Use the defaults: build, ensure the fixture server, and profile one run
bun ws trees profile:virtualization

# Reuse an already running build + fixture server
bun ws trees profile:virtualization -- --no-build --no-server

# Run multiple benchmark passes and print per-run + aggregate tables
bun ws trees profile:virtualization -- --runs 5

# Discard warm-up runs before measuring the reported runs
bun ws trees profile:virtualization -- --warmup-runs 2 --runs 8

# Run multiple named workloads in one command
bun ws trees profile:virtualization -- --workload pierre-snapshot --workload linux --workload linux-5x --runs 5

# Add function call counts to the bottom-up CPU table
bun ws trees profile:virtualization -- --call-counts

# Show the lower-signal dominant trace event table
bun ws trees profile:virtualization -- --dominant-trace-events

# Compare the hidden benchmark hook surface with the collector disabled
bun ws trees profile:virtualization -- --instrumentation off --runs 5

# Emit machine-readable benchmark output
bun ws trees profile:virtualization -- --runs 5 --json

# Save a JSON baseline, then compare the current code against it
bun ws trees profile:virtualization -- --workload linux --workload linux-5x --runs 5 --json > tmp/trees-virtualization-baseline.json
bun ws trees profile:virtualization -- --workload linux --workload linux-5x --runs 5 --compare tmp/trees-virtualization-baseline.json
```

Flags:

- `--browser-url <url>` to point at a different Chrome remote debugging base URL
- `--url <url>` to profile a different page than the default virtualization
  fixture. Existing query params on a custom URL are preserved.
- `--workload <name>` to select one or more named fixture workloads for the
  built-in virtualization fixture
- `--timeout <ms>` to change navigation/render/trace timeout behavior
- `--runs <count>` to execute the benchmark multiple times sequentially
- `--warmup-runs <count>` to run and discard warm-up passes before reporting
- `--instrumentation <mode>` to run the fixture collector in `on` or `off` mode
- `--call-counts` to run a second precise-coverage pass and annotate bottom-up
  functions with invocation counts
- `--dominant-trace-events` to show the lower-signal dominant trace event table
  in human output
- `--trace-out <path>` to choose the trace output location
- `--compare <path>` to compare the current benchmark run against a saved
  `--json` output
- `--no-build` to skip rebuilding `dist/`
- `--no-server` to assume the fixture server is already running
- `--json` to emit the full benchmark object without a human summary

Trace files are written to the system temp directory by default. For multi-run
benchmarks the command appends `-run-N` to the trace filename so each run keeps
its own trace. For multi-workload benchmarks it also includes the workload name
in each trace filename.

`--call-counts` is intentionally not enabled by default. It uses Chrome precise
coverage, which runs as a separate auxiliary pass so the timed benchmark run is
not perturbed.

`--dominant-trace-events` is also off by default. Those event-name aggregates
are useful for occasional trace debugging, but they are easier to over-interpret
than the phase tables and bottom-up CPU output.

`Visible rows ready` is the time until the first virtualized rows are present in
the shadow DOM. `Post-paint ready` adds the extra double-`requestAnimationFrame`
settle used by the fixture so the top-line metric more closely reflects the
interactive click-to-render experience.

The JSON output now includes:

- `benchmark`
- `config`
- `workloads`
- optional `comparison`

Each workload entry contains:

- `workload`
- `runs`
- `summary`

Each workload `summary` includes the same aggregate metrics that power the
human-readable multi-run table. Every metric reports:

- `availableRuns`
- `totalMs`
- `averageMs`
- `medianMs`
- `p95Ms`

When `--compare` is used, the human-readable output adds per-workload median and
P95 delta tables, and the JSON output adds a `comparison` block keyed by
workload name.

### Instrumentation overhead

We measured the cost of the benchmark phase/counter hooks on March 27, 2026 so
future refactors do not need to re-run this comparison unless the hook surface
changes materially.

Method:

- 16 runs per case against the same real Chrome instance and Linux fixture
- drop the first run as warm-up, summarize the remaining 15 runs
- compare three cases:
  - pre-phase-instrumentation baseline at commit `5de4dd18`
  - current runtime hook surface with fixture instrumentation disabled via
    `--instrumentation off`
  - current runtime hook surface with fixture instrumentation enabled

Click-to-render-ready results:

| Case                                      |   Average |    Median |       P95 |
| ----------------------------------------- | --------: | --------: | --------: |
| Pre-instrumentation baseline (`5de4dd18`) | 880.62 ms | 879.75 ms | 890.30 ms |
| Current code, instrumentation disabled    | 877.72 ms | 876.49 ms | 887.54 ms |
| Current code, instrumentation enabled     | 879.74 ms | 879.19 ms | 887.74 ms |

Takeaways:

- The remaining runtime hook surface did not show a measurable slowdown. In this
  sample it was about `2.9 ms` faster than the old baseline, which should be
  treated as noise rather than a true speedup.
- Enabling the collector added about `2.0 ms` average to click-to-render-ready,
  or roughly `0.2%` on an ~`880 ms` render.
- Net of both effects, the fully instrumented current build was still within
  about `1 ms` of the old baseline on average.

Bundle-size impact of the current injected-hook design:

- about `5.0 KB` uncompressed across the touched runtime modules
- plus a `580 B` `dist/internal/benchmarkInstrumentation.js` bridge module

This comparison was run after the injection refactor at commit `53441cfe`, which
keeps the real collector implementation in
`test/e2e/fixtures/benchmarkInstrumentation.ts` and leaves only the optional
hook surface in `src/`.

# Credits and Acknolwedgements

The core of this library's underlying tree implementation started as a hard fork
of [@headless-tree/core](https://github.com/lukasbach/headless-tree) by
[@lukasbach](https://github.com/lukasbach) under the MIT License (forked at
1.6.1). This library is invaluable, and if you're interested in a headless tree
implementation it is one of the best possible places to start. We opted to fork
it only to meet some extreme customizations we wanted to make quickly for our
specific use-cases. Ultimately, we hope to offer anything generalizable back
upstream if it's desired. We have ported many of the tests from the library as
well in an attempt to maintain as much compatibility for future collaboration.
