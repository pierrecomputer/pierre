# Bulk worker second-pass experiment plan

## Goal

Find the next meaningful responsiveness wins before multi-worker handoff or
shared memory, while keeping the `visibleRows` shape honest for the real
`FileTree` path.

## Constraints and decisions

- Do not slim `visibleRows` in ways that would make the experiment faster only
  by diverging from the real `FileTree` contract.
- Stay demo-local for this pass.
- Keep `head-start`, `chunked`, and `oneshot` externally truthful.
- Add controls where they help isolate bottlenecks or compare strategies.
- Defer transferables until after coalescing, frontier gating, and
  publish-cadence experiments are measured.
- Do not pursue `SharedArrayBuffer` / `Atomics` in this pass.

## What the current measurements imply

The first pass changed the bottleneck profile:

- `visibleRows` compute inside the worker is now small.
- steady-state worker reads are dominated by queue wait plus message transport /
  clone time.
- chunked and head-start still show rare large queue spikes during active
  ingest.
- `chunked` total ingest time is now much worse than `oneshot`, which suggests
  committed snapshot promotion is expensive.

That points to three next experiments:

1. reduce stale and duplicate read requests
2. skip read work when the viewport is unaffected by new committed rows
3. reduce how often committed snapshots are rebuilt, without lying about visible
   state

## Why committed snapshot rebuilds exist today

The current committed snapshot boundary is not accidental. It provides:

- a stable read view while the mutable working store keeps ingesting
- honest publish points for `head-start` and `chunked`
- a clean final-only publish boundary for `oneshot`
- deterministic inputs for scroll anchoring and visible range reads

Any plan to publish less often must preserve those benefits.

## What we lose if we publish less often

If working checkpoints and committed publishes are decoupled, we lose immediacy,
not correctness.

Specifically:

- newly ingested rows can remain invisible for longer
- `getVisibleIndex` for paths that only exist in the working store cannot
  resolve until the next committed publish
- checkpoint milestones stop meaning “the UI can already read this” unless we
  distinguish working progress from committed progress
- anchor correction and viewport reads continue to operate against the last
  committed snapshot, so the UI can lag behind ingest progress by a bounded
  amount

Those are acceptable only if we make the lag explicit and bounded.

## Why decoupled publishing can still work in practice

This can work if we preserve a strict invariant:

- **all reads come from the last committed snapshot**
- **all writes continue in the working store**
- **committed publishes happen on an independent cadence with explicit bounds**

That preserves consistency while reducing rebuild frequency.

The existing demo already tolerates a gap between total ingest progress and
readable visible state:

- preview-prefix fallback already covers top-of-list stability before deeper
  data is committed
- unresolved-frontier UI already communicates that not everything is
  materialized yet
- `oneshot` already proves the UI can remain coherent while the working store is
  ahead of the committed view

So the practical question is not whether lag is allowed at all. It already is.
The real question is how much lag we can allow before the demo becomes
misleading or unpleasant.

## Proposed controls to add

Add route-state backed controls so we can compare strategies on the same page.

### Read scheduling controls

- `readStrategy`
  - `exact`
  - `latest-only`
  - `latest-only-slab`
- `readSlabMultiplier`
  - number of viewports requested per read slab
  - start with `1`, `2`, `4`
- `readBatching`
  - `immediate`
  - `raf`

### Refresh invalidation controls

- `frontierGating`
  - `off`
  - `on`
- `anchorRefresh`
  - keep current anchor correction behavior
  - optionally gate anchor re-resolution when the top viewport is unchanged

### Apply / publish controls

- `applySliceBudgetMs`
  - current cooperative ingest budget
- `applySlicePathCount`
  - current sub-slice path count
- `publishStrategy`
  - `every-checkpoint`
  - `time-budget`
  - `checkpoint-count`
  - `path-budget`
- `publishBudgetMs`
  - max committed snapshot age before forced publish
- `publishEveryNCheckpoints`
  - publish after every N working checkpoints
- `publishPathBudget`
  - publish after this many unpublished paths

### Metrics and diagnostics controls

- `logReadRequests`
  - verbose request lifecycle logging for active diagnosis
- `showWorkingProgress`
  - render working vs committed progress side by side
- `showPublishStats`
  - render committed snapshot age, unpublished path count, dropped request
    count, cache hit rate, and publish rebuild time

## Metrics to add before changing behavior

Extend the current latency surface with:

- `visibleRows` requests sent
- `visibleRows` requests completed
- `visibleRows` requests superseded / dropped
- slab cache hit rate
- slab cache miss rate
- committed snapshot publishes
- average / p95 committed publish rebuild ms
- max committed snapshot age during ingest
- max unpublished path count during ingest
- working progress vs committed progress

Without those numbers, decoupled publishing will be guesswork.

## Implementation sequence

### Phase 1: request coalescing and slab caching

#### Objective

Attack the bad queue-wait tail without changing the `visibleRows` contract.

#### Changes

1. Extend the demo adapter layer so `visibleRows` reads can be scheduled through
   a small request coordinator.
2. Implement `latest-only` mode:
   - allow at most one in-flight `visibleRows` request
   - if a newer range arrives, keep only the latest desired range
   - once the current request resolves, issue only the newest pending one
3. Implement `latest-only-slab` mode:
   - request an overscanned slab rather than the exact viewport
   - satisfy nearby scroll movement from the cached slab on the main thread
4. Add request counters:
   - sent
   - completed
   - dropped as superseded
   - cache hits / misses

#### Files

- `apps/docs/app/trees-dev/_lib/bulkExperimentProtocol.ts`
- `apps/docs/app/trees-dev/_lib/bulkExperimentMeta.ts`
- `apps/docs/app/trees-dev/_demos/BulkIngestDemoClient.tsx`
- `apps/docs/app/trees-dev/_workers/bulkExperiment.worker.ts`

#### Success criteria

- active-ingest queue spikes shrink materially in chunked and head-start modes
- the visible tree still behaves identically from the user’s perspective
- steady-state `visibleRows` p50 stays flat or improves

### Phase 2: frontier-aware refresh gating

#### Objective

Stop asking for rows when the committed viewport did not actually change.

#### Changes

1. Teach the model snapshot to expose enough information to know whether the
   visible viewport intersects the newly committed frontier.
   - simplest starting point: first committed affected visible index, or a
     committed visible-version token plus frontier location
2. Gate `getVisibleRows(range.start, range.end)` refreshes when:
   - the viewport is fully above the affected region
   - the existing slab still covers the requested range
3. Keep anchor correction honest:
   - if the anchor path is above the affected region, skip `getVisibleIndex`
   - otherwise use the existing correction path

#### Files

- `apps/docs/app/trees-dev/_lib/bulkExperimentProtocol.ts`
- `apps/docs/app/trees-dev/_lib/bulkExperimentModel.ts`
- `apps/docs/app/trees-dev/_demos/BulkIngestDemoClient.tsx`

#### Success criteria

- fewer active-ingest `visibleRows` requests
- fewer `visibleIndex` repairs during unaffected top-of-list viewing
- no regressions in preview-prefix retention or scroll anchoring

### Phase 3: decouple working checkpoints from committed publishes

#### Objective

Reduce expensive committed snapshot rebuild frequency while preserving
consistent reads.

#### Strategy

Keep two concepts separate:

- **working checkpoint**: mutable ingest progress in the working store
- **committed publish**: frozen readable snapshot promotion

The worker keeps ingesting through working checkpoints as often as needed, but
only promotes the committed snapshot when a publish budget says it should.

#### Required invariants

- reads always answer from committed state only
- committed progress is what drives `visibleRows`, `visibleIndex`, and current
  snapshot consumers
- working progress is displayed separately and never silently treated as
  readable state
- `oneshot` still publishes only at completion
- `head-start` still forces a committed publish for the head chunk before tail
  lag begins

#### Proposed publish strategies to compare

- `every-checkpoint` — current baseline
- `checkpoint-count` — publish every N working checkpoints
- `time-budget` — publish when committed snapshot age exceeds X ms
- `path-budget` — publish when unpublished path count exceeds X
- hybrid — publish when either time or path budget trips

#### What must remain true between publishes

- viewport reads may lag, but only to the last committed snapshot
- unresolved frontier / progress UI must communicate the lag honestly
- anchor correction must never mix working and committed indices
- interactions such as expand / collapse must update both stores or be routed
  through a single canonical mutation path so committed and working state do not
  diverge structurally

#### Risk

The main risk is not wrong rows. The main risk is stale-but-consistent rows for
too long.

That is why the experiment needs explicit staleness metrics and controls.

#### Files

- `apps/docs/app/trees-dev/_lib/bulkExperimentProtocol.ts`
- `apps/docs/app/trees-dev/_lib/bulkExperimentMeta.ts`
- `apps/docs/app/trees-dev/_lib/bulkExperimentModel.ts`
- `apps/docs/app/trees-dev/_demos/BulkIngestDemoClient.tsx`
- potentially `packages/path-store/` if committed snapshot promotion itself
  becomes the next thing to optimize

#### Success criteria

- chunked total ingest time drops materially versus current `every-checkpoint`
  rebuilds
- active-ingest read latency does not regress beyond an agreed bound
- UI remains coherent and clearly communicates committed vs working progress
- `head-start` and `oneshot` semantics remain intact

### Phase 4: transferables, only if still justified

#### Objective

Attack the steady-state transport cost only if phases 1–3 leave it dominant.

#### Changes

1. Keep the full `visibleRows` data contract, but encode row slabs into a
   transferable format.
2. Start with a demo-only encoder / decoder:
   - fixed-width numeric columns in typed arrays
   - string table for paths / labels / flattened segments
3. Transfer underlying `ArrayBuffer`s rather than relying on full structured
   clone of object arrays.

#### Gate for doing this work

Only do this if, after phases 1–3:

- queue wait is no longer the dominant problem
- steady-state transport still makes up most of active worker read time

## Verification matrix

Run the same route matrix after each phase:

- `/trees-dev/bulk`
- `/trees-dev/bulk?worker=0`
- `/trees-dev/bulk?ingest=chunked`
- `/trees-dev/bulk?ingest=oneshot`
- `/trees-dev/bulk?head=1000`

Validate:

1. active-ingest request breakdown still separates queue / compute / transport /
   total
2. request volume, dropped-request count, and cache-hit metrics respond to
   control changes as expected
3. `oneshot` still publishes only at the end
4. `head-start` still publishes the head chunk early
5. preview-prefix rows remain visible when scrolling away and back before full
   completion
6. anchor correction stays stable when committed publishes are delayed
7. working progress and committed progress never get conflated in the UI

## Tiny-commit plan

1. Add route-state plumbing and no-op UI controls for read strategy and publish
   strategy.
2. Add request and publish counters to the metrics surface.
3. Add `latest-only` visible-row coalescing behind a control.
4. Add slab caching behind a control.
5. Add frontier-aware refresh gating behind a control.
6. Add working-vs-committed progress metrics and render them.
7. Add decoupled publish scheduling with `every-checkpoint` as the default
   baseline.
8. Add `checkpoint-count` publish mode.
9. Add `time-budget` / `path-budget` publish modes.
10. Compare all modes and keep the simplest one that materially improves both
    tail latency and total ingest time.
11. Only if transport still dominates, add a transferables experiment behind a
    control.

## Decision rules

- If coalescing + slab caching remove most of the queue tail, keep publish
  strategy conservative.
- If decoupled publishing materially cuts chunked total time without making
  committed lag objectionable, keep it and make the lag explicit in the UI.
- If transport remains the dominant steady-state cost after those wins, move to
  transferables.
- If queue tail remains unacceptable even after coalescing and decoupled
  publishing, the next step is likely multi-worker handoff, not more tuning.

## Out of scope

- shared memory
- Atomics
- changing the public `FileTree` row contract to a smaller shape
- production architecture beyond what this demo can prove
