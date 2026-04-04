# @pierre/path-store Implementation Plan

This document captures the current design plan for `@pierre/path-store`.

It is intentionally more detailed than the package README. The goal is to keep
the reasoning, invariants, and tradeoffs close to the implementation while the
design is still fresh.

This is a planning document, not a promise that every detail below will survive
contact with real benchmarks unchanged. The point is to record the current best
plan so implementation can start from a coherent set of decisions.

## Status

The package is being designed as a standalone, runtime-agnostic store whose
primary job is to power `@pierre/trees`.

The design is explicitly biased toward:

- extremely large path sets
- fast initial ingest
- fast single interactive mutations
- virtualized visible-range reads
- worst-case realistic tree shapes

The design is not primarily optimized for:

- full visible-list materialization after every edit
- arbitrary payload objects on every path during ingest
- generalized UI abstractions beyond what `@pierre/trees` needs

## Primary Goals

- Ingest hundreds of thousands to millions of paths quickly.
- Keep interactive mutations from scaling linearly with total tree size when
  possible.
- Make fully expanded trees practical when only a small visible window is
  rendered.
- Support future async loading and chunked ingest without changing the core
  model.
- Remain runtime agnostic and dependency free.
- Favor state-of-the-art performance over minimal implementation complexity.

## Non-Goals

- Perfectly generic tree data APIs.
- Preserving original ingest order.
- Making full `list()` materialization the primary optimized path.
- Supporting platform-specific path normalization rules in the core package.
- Supporting arbitrary user payload objects on the primary ingest path.

## Benchmark Contract

The main benchmark target is not "rebuild the whole visible list quickly." The
main target is:

1. Build or mutate a very large tree.
2. Immediately answer `getVisibleCount()`.
3. Immediately answer `getVisibleSlice(start, end)` for a bounded rendered
   window.

The reference workload is the existing Linux-kernel-style benchmark already used
in `@pierre/trees`:

- around 500k files in the current benchmark shape
- fully expanded worst-case tree
- eventually expected to scale toward 1M visible entries
- a rendered window bounded to roughly 200 rows for benchmarks

This document assumes:

- "fully expanded" does not mean "fully materialized visible list"
- the list must still support fast arbitrary scroll jumps
- the renderer will only request a small visible slice plus overscan

Secondary benchmarks still matter, but are not the primary optimization target:

- full canonical `list()` materialization
- initial ingest throughput
- single leaf rename
- wide-directory random access
- bursty watcher transactions

Current implementation note:

- `flattenEmptyDirectories` now flattens single-child directory chains in the
  visible projection while preserving canonical topology and path-first
  mutations. It now defaults to enabled, with explicit `false` used in tests and
  fixtures that need canonical one-directory-per-row visibility.
- Phase 6 now exposes typed semantic events with conservative structural
  invalidation metadata:
  - `canonicalChanged`
  - `projectionChanged`
  - operation-specific canonical paths like `path`, `from`, and `to`
  - `visibleCountDelta` when it is honest to compute Advisory affected-ID fields
    remain available, but they should not be treated as the long-term primary
    contract until cleanup/compaction semantics are more explicit.
- Phase 7A now starts the async model with explicit store-owned primitives for:
  - marking a directory unloaded
  - beginning a child load with deduped attempt handles
  - applying incremental child patches
  - completing or failing a load attempt Runtime/scheduler policy remains
    outside the store for now. `markDirectoryUnloaded(path)` is intentionally
    limited to directories without known children, and visible-row `loadState`
    is intentionally sparse: the always-available fast flag is `isLoading`,
    while `loadState` only appears when a directory row is not in the default
    loaded state. `PathStoreChildPatch.metadata` is reserved for future
    count/reservation hints and is intentionally ignored in 7A. The current
    `applyChildPatch()` preflight validates patches against a throwaway subtree
    store before mutating the real store so failed later operations cannot leave
    partial state behind. That is an intentional correctness-first O(n) tradeoff
    for large directories and a likely future optimization target once 7A
    semantics are stable.

For mutation scenarios, the benchmark contract should explicitly model the next
store-side read the UI would perform after the mutation commits:

- `getVisibleCount()`
- `getVisibleSlice(start, end)`

Mutation scenarios should declare which of these two read models they are
simulating:

- `render-changed-window` The post-mutation window must include the changed row
  or changed region. If the original viewport still contains that region, reuse
  it. If not, shift the window only as much as needed to bring the changed
  region back into view.
- `preserve-viewport` The post-mutation window is intentionally kept at the
  original viewport to measure the cost of offscreen changes while the current
  view stays live.

This distinction is important because "time until the changed thing can render"
and "time until an unrelated viewport stays responsive" are both useful, but
they answer different questions.

## Design Summary

The current recommended shape is:

1. A canonical mutable tree with stable numeric node IDs.
2. Adaptive per-directory child indexes.
3. Implicit visible order derived from subtree visible counts.
4. Slice-first visible APIs built on `select(k)` plus sequential window walks.
5. Flattening as a projection, not canonical topology.
6. A builder as the primitive ingest mechanism.
7. Transactions for bursty writes and future streaming/async loaders.

This is intentionally closer to "canonical topology plus projection metadata"
than to "global visible list plus patches."

## Why This Direction

The main design decision is to avoid making either of these the primary source
of truth:

- a fully materialized visible-order array
- a long-lived transform overlay that rewrites reads on the fly

Those ideas can be useful as secondary optimizations, but both become awkward
for the target workload:

- fully materialized visible order becomes expensive to maintain under large
  visible reorders
- transform overlays make reads slower over time and complicate correctness

The chosen direction makes the canonical tree the source of truth and keeps
visible order implicit.

## Core Model

### Canonical Topology

The canonical structure is a mutable path tree with stable internal IDs.

Each node represents either:

- a file
- a directory

Each node stores canonical structure, not projection state.

Planned core fields:

```ts
type NodeId = number;
type SegmentId = number;

type NodeKind = 0 | 1; // file | directory

type Node = {
  id: NodeId;
  parentId: NodeId;
  nameId: SegmentId;
  kind: NodeKind;
  depth: number;
  flags: number;
  childIndexRef?: number;
  explicitChildCount?: number;
  subtreeNodeCount?: number;
  visibleSubtreeCount?: number;
  pathCache?: string;
  pathCacheVersion?: number;
};
```

The exact field packing may change, but the intended semantics are:

- stable numeric node ID
- parent pointer
- segment-level name reference, not full path string
- canonical kind
- enough local metadata to support visible selection and fast mutation

### Numeric IDs

Node IDs should be numeric internally.

Reasons:

- lower memory overhead than strings
- better fit for dense side tables
- better fit for future worker transport and compact caches
- easier to compact later if needed

If the DOM or a public API needs string identifiers, conversion should happen at
the edge.

### Segment Interning

Segment names should be interned globally.

Planned shape:

```ts
type SegmentTable = {
  idByValue: Map<string, SegmentId>;
  valueById: string[];
  sortKeyById: SegmentSortKey[];
};
```

Reasons:

- many segment names repeat across large trees
- reduces duplicate string retention
- enables integer-based comparisons in hot paths
- allows per-segment sort metadata to be computed once

### Sort Metadata

The default canonical ordering should be:

- directories first
- then natural/alphanumeric segment order

This matches the intended `@pierre/trees` experience and gives one optimized
default path through the code.

Custom comparators are allowed as an escape hatch, but they are not the primary
optimization target.

Changing sort policy is allowed, but it is explicitly treated as a rebuild-class
operation.

### Path Storage

Nodes should not store eagerly maintained full path strings as canonical
always-hot state in mutable mode.

Instead:

- store `parentId + nameId`
- materialize full paths lazily
- cache materialized paths with invalidation/versioning

Reasoning:

- visible reads only need paths for the requested window
- folder move/rename should not require eager descendant path rewriting
- full path strings are one of the largest memory multipliers

This is a deliberate trade of:

- slightly more work per visible-window read
- for significantly cheaper subtree moves/renames

### Explicit vs Implicit Directories

Directories can be created in two ways:

- explicitly, for example `tmp/`
- implicitly, as ancestors of descendants

The model should track whether a directory has explicit presence.

Example:

- ingesting `src/index.ts` creates `src/` implicitly
- ingesting `tmp/` creates `tmp/` explicitly

This should be tracked with a directory flag such as `isExplicitDirectory`.

## Directory Persistence Rules

Directories are first-class nodes.

Canonical rules:

- descendant paths create missing ancestor directories
- once a directory exists, it persists until explicitly removed
- if a directory becomes empty, it is promoted to explicit
- explicit trailing `/` remains meaningful because it can create an otherwise
  disconnected empty directory

This decision is intentionally filesystem-like and helps preserve round-trips.

## Canonical Round-Trip Invariant

The output of canonical `list()` should be usable to recreate the same store
shape:

```ts
const paths = store.list();
const rebuilt = new PathStore({ paths });
```

The rebuilt store should have the same canonical topology.

To support that:

- `list()` returns all files
- `list()` returns all explicit empty directories
- `list()` does not need to return non-empty implicit directories, because their
  descendants recreate them

## Child Index Strategy

### Adaptive Per-Directory Indexes

Directories should not all use one child representation.

The design should support adaptive child containers so small directories stay
compact while wide directories become fast for indexed visible selection.

Planned progression:

1. Small directory: compact child array.
2. Medium directory: child array plus chunked prefix summaries.
3. Large directory: heavier aggregate structure such as a Fenwick-style index or
   equivalent local aggregate tree.

The exact thresholds should be benchmark driven.

### Why Adaptive Indexes

Most directories are small.

A single heavyweight structure for every directory would waste memory and slow
the common case.

But worst-case random visible jumps depend on quickly locating which child
contains the target visible row, and wide directories make naive linear scans
too expensive.

Adaptive indexes give:

- compact memory for normal trees
- fast `select(k)` in pathological wide directories

### What Child Indexes Must Support

Per-directory child indexes need to support:

- canonical child ordering
- fast child lookup by segment
- insert/remove/move within the parent
- local aggregate maintenance when a child's `visibleSubtreeCount` changes
- efficient selection of the child whose subtree contains a visible offset

This means child indexes are not only sort containers. They are also local
aggregate structures.

## Visible Projection Model

### Store-Owned Visible State in v1

For v1, visible projection state should live on the main store instance, not in
a separately exposed view object.

Reasons:

- keeps the initial API smaller
- avoids over-optimizing for rare multi-view use cases
- lets the store own fast visible-range reads directly

However, canonical topology should still stay conceptually separate from
projection semantics so a future view/projection split remains possible.

### Expansion State

Expansion state should be first-class because visible reads are a core feature.

The store should own:

- expanded/collapsed state
- visible subtree counts
- flattening-aware visible projection metadata

This makes `getVisibleCount()` and `getVisibleSlice()` incremental and fast.

### Visible Order Is Implicit

Visible order should not be kept as one eagerly maintained global list.

Instead:

- each node maintains enough metadata to know how many visible rows its subtree
  contributes under the current projection settings
- the store answers visible reads by selecting into the tree

This avoids full visible-list rebuilds after large mutations.

### Visible Selection

The core visible primitive should be conceptually:

```ts
selectVisibleRow(index: number): NodeCursor
```

`getVisibleSlice(start, end)` should be implemented by:

1. locating the first visible row with `selectVisibleRow(start)`
2. walking forward sequentially for the rest of the window

That is much better than:

- scanning from the root every time
- doing an independent root-to-leaf selection for every row in the slice

### Visible Window Performance Goal

The design target is:

- fast cold selection into arbitrary visible windows
- then very fast sequential walking for the next ~200 rows

This is the reason subtree counts and adaptive child indexes are core features.

### Visible Row Payload

Visible rows should be materialized on demand for the requested slice.

They should be lightweight plain-object snapshots, not heavyweight objects with
many methods.

Planned shape:

```ts
type VisibleRow = {
  rowId: number | string;
  nodeId: NodeId;
  path: string;
  name: string;
  depth: number;
  kind: 'file' | 'directory';
  isExpanded: boolean;
  isLoading: boolean;
  hasChildren: boolean;
  isFlattened: boolean;
  flattenedSegments?: FlattenedRowSegment[];
};
```

The important rule is:

- no global precomputation of all rows
- yes to rich enough row snapshots for the renderer

### Arbitrary Scroll Jumps

The store must support fast jumps into cold visible regions.

That means:

- `getVisibleSlice(start, end)` cannot scan from the top
- the store must support efficient `select(k)` behavior

Optional sampled anchor caches may be explored later, but they should only ever
be secondary caches. They should not be the core correctness mechanism.

## Flattening Model

### Flattening Is a Projection

Flatten-empty-directories should not change canonical topology.

Canonical nodes remain real files and directories.

Flattening only changes how visible rows are projected.

This avoids:

- canonical identity churn
- awkward move/rename semantics for synthetic nodes
- extra complexity when async loading changes whether a chain is flattenable

### Flattened Rows Must Preserve Segment Detail

A flattened row may render as one row, but it still needs the full chain of
segments for interaction behavior such as:

- independent focus targets
- drop targets
- rename targeting
- async loading transitions

So a flattened row should carry flattened chain information, not just one opaque
combined label.

Planned shape:

```ts
type FlattenedRowSegment = {
  nodeId: NodeId;
  name: string;
  path: string;
  isTerminal: boolean;
};
```

This lets a single visible row still map back to several canonical directory
nodes.

### Flattening Policy

Flattening should be configurable, but effectively fixed during normal
operation.

Changing flattening policy is allowed, but should be treated as a rebuild-class
operation, similar to changing the sort policy.

## Async Loading Model

### Core State

The canonical baseline should be:

- a directory can exist while its children are unknown

Directories should be able to represent:

- `unloaded`
- `loading`
- `loaded`
- `error`

Optional metadata such as `knownChildCount` may be supported, but should not be
required for correctness.

### Why Optional Known Counts

Some loaders may know:

- the folder exists
- the number of children
- but not the child identities yet

That can help with future UI reservation strategies, but the model should not
depend on it.

### Loading Capability vs Loading Policy

The store should own:

- load state
- deduping in-flight child loads
- incremental application of loaded children
- invalidation primitives

The higher-level `@pierre/trees` integration should own:

- when to load
- whether to prefetch
- how aggressively to stay ahead of the viewport
- concurrency budgets and scheduling policy

This split is chosen for performance, not abstraction purity. The UI/runtime
layer knows the viewport and user behavior. The store knows canonical structure
and how to patch it efficiently.

### Incremental Application

Async child loads should patch the store incrementally.

They should not trigger whole-tree rebuild semantics as the primary strategy.

## Mutation Semantics

### Core Operations

Primary semantic operations:

- `add(path)`
- `remove(path, options?)`
- `move(from, to, options?)`
- `batch(operations)`

`rename` is just a move.

### Collision Policy

Default collision policy should be:

- throw unless explicitly resolved

This is safer and keeps semantics cleaner than implicit overwrite/merge rules.

Optional explicit policies may be added later, but the default should be
defensive.

### Remove Semantics

- removing a file removes the file
- removing an empty directory removes the directory
- removing a non-empty directory should require `recursive: true`

This keeps subtree deletion explicit and filesystem-like.

### Move Semantics

Move semantics should follow `mv`-style behavior:

- if destination does not exist, move/rename to that exact path
- if destination exists and is a directory, move the source into it, preserving
  the basename
- collisions default to error

### Parent Persistence

Ancestor directories should not be aggressively pruned during normal mutations.

Once created, directories persist until explicitly removed.

This reduces ancestor churn and better matches filesystem-like behavior.

## Transactions

### Why Transactions Are First-Class

Transactions are required for:

- bursty filesystem watcher updates
- lazy child insertion
- future worker-fed ingest
- future streaming builds

The store should support applying multiple semantic operations while deferring
projection updates and event emission until commit.

### Transaction Guarantees

A transaction should:

- preflight collisions before mutation where possible
- batch structural updates
- batch visible metadata repair
- emit one coherent event payload at commit

### Watchers

The canonical store should remain watcher-agnostic.

Watcher adapters can normalize external semantics into store transactions.

The current preferred watcher direction is `@parcel/watcher`, with a snapshot
diff adapter also expected to be useful.

Raw watcher semantics should not define the canonical store API.

## Event Model

### Event Richness

Events should be richer than pure semantic notifications, but stop short of
direct renderer splice instructions.

Chosen level:

- semantic operation info
- structural invalidation metadata

Examples of structural invalidation metadata:

- affected directory IDs
- affected ancestor IDs
- whether projection-visible metadata changed
- whether flattening may have changed in the affected region

### Why Not Renderer Splice Deltas

Direct visible-range splice instructions would over-couple the store to one
renderer and one projection instance. That is too brittle for v1.

Level-2 structural invalidation is the intended sweet spot.

## Builder and Ingest Model

### Builder Is the Primitive

The real ingest primitive should be a builder/streaming pipeline.

`new PathStore({ paths })` should be sugar over the builder.

Reasons:

- sorted bulk ingest
- unsorted preprocessing
- worker-fed chunking
- main-thread cooperative chunking
- async-loaded child insertion
- future snapshot diff reuse

### Sorted Fast Path

The builder should assume sorted canonical input for the fastest path.

Benefits:

- prefix reuse between consecutive paths
- fewer repeated ancestor lookups
- natural sibling insertion order
- less sorting work during build

### Unsorted Input

Unsorted input should still be supported, but not treated as the fastest path.

The package should provide a very fast prepare/sort utility for callers that do
not already have sorted input.

### Streaming Shape

Planned builder shape:

```ts
const builder = PathStore.createBuilder(options);
builder.appendPaths(chunkA);
builder.appendPaths(chunkB);
const store = builder.finish();
```

This should be flexible enough to support:

- synchronous construction
- worker-fed chunk streams
- cooperative main-thread chunking
- future async folder loads

## Async and Worker Ingest

### Runtime-Agnostic Core

The core store should not require workers.

It must work synchronously in any runtime.

### Async Schedulers

Async ingest should be provided as layered scheduling strategies:

- worker-backed ingest where available
- cooperative main-thread chunking as fallback

Current Phase 7B status:

- cooperative scheduling now exists as an **optional helper** via the root
  package export: `createPathStoreScheduler({ store, ... })`
- the helper owns queueing, yielding, cancellation, and backpressure mechanics
  around the existing 7A store primitives
- caller code still owns load ordering and priority; first 7B intentionally does
  **not** ship built-in viewport-aware prioritization, prefetch heuristics, or
  reservation/count-hint strategy
- worker-backed execution remains a documented follow-up seam rather than a
  public first-pass runtime contract

### Why Worker Mode Is Optional

Posting millions of strings to a worker can be expensive because strings are
cloned. That makes worker mode desirable but not automatically free.

The design should leave room for better transport later, such as:

- chunked path batches
- encoded buffers with offsets
- potentially shared memory where appropriate

But those transport optimizations should not be required to start building the
core.

### WASM

WASM may become useful later, but it should not be assumed to be a win in the
first pass. String-heavy workloads often erase the expected benefit.

Benchmark the JS core first, then reconsider.

## Canonical Queries

### Canonical `list()`

Canonical listing should stay separate from visible projection queries.

Planned APIs:

- `list()`
- `list(subtreePath)`
- `getVisibleCount()`
- `getVisibleSlice(start, end)`

`list()` should describe stored topology, not display projection.

### Subtree Enumeration

Canonical subtree enumeration matters, but it is not the primary hot path.

The primary hot path is bounded visible-range access after expand/collapse and
after interactive mutations.

## API Direction

The exact API will evolve, but the current intended direction looks roughly like
this:

```ts
type PathStoreOptions = {
  sort?: 'default' | CustomComparator;
  flattenEmptyDirectories?: boolean;
};

type RemoveOptions = {
  recursive?: boolean;
};

type MoveOptions = {
  collision?: 'error' | 'replace' | 'skip';
};

type VisibleSliceOptions = {
  start: number;
  end: number;
};

class PathStore {
  static createBuilder(options?: PathStoreOptions): PathStoreBuilder;

  list(path?: string): string[];
  add(path: string): void;
  remove(path: string, options?: RemoveOptions): void;
  move(from: string, to: string, options?: MoveOptions): void;
  batch(fnOrOperations: unknown): unknown;
  getVisibleCount(): number;
  getVisibleSlice(start: number, end: number): VisibleRow[];
  expand(path: string): void;
  collapse(path: string): void;
  on(type: string, handler: (event: PathStoreEvent) => void): () => void;
  cleanup(options?: CleanupOptions): CleanupResult;
}
```

This is an illustrative sketch, not a locked API.

## Memory and Cleanup Strategy

### Append-Only IDs During Normal Operation

Normal mutation flow should not aggressively recycle IDs or compact arrays.

Reasons:

- simpler correctness
- better interactive latency
- less churn in side tables

### Explicit Cleanup API

The store should expose a cleanup/compaction API that users can call when they
want to trade a heavier one-time rebuild for better long-term memory density.

Current Phase 8A status:

- cleanup is a **manual** API surface, not an automatic/background policy
- the stable cleanup path preserves observable node IDs by default
- an explicit aggressive cleanup mode may reset IDs for denser compaction
- stable cleanup only reclaims **trailing** tombstone slots; aggressive mode is
  the path for fully dense node-array compaction
- stable cleanup clears path caches intentionally, trading a later
  rematerialization cost for immediate memory reclamation
- static/read-only mode exploration remains deferred to 8B
- worker follow-up from 7B remains a separate deferred thread

Potential cleanup tasks:

- rebuild dense node arrays
- rebuild child indexes
- rebuild path caches
- compact tombstones
- optionally optimize into a more static representation

## Possible Static Mode

The design leaves room for a later read-only/static mode.

That mode could choose different tradeoffs, such as:

- more aggressive path indexing
- more aggressive full-path caching
- denser compact structures

Current Phase 8B status:

- `StaticPathStore` is now a public read-only type
- it preserves the current read/query surface:
  - `list()`
  - `getVisibleCount()`
  - `getVisibleSlice()`
  - `expand()`
  - `collapse()`
- it intentionally omits topology mutation APIs and the mutable-mode event
  emitter
- it ships because the representative `linux-5x` benchmarks show read wins over
  the mutable baseline on:
  - canonical `list()`
  - `visible-first`
  - `visible-middle`
- its expand/collapse path currently recomputes static visible counts globally,
  and that cost is now measured explicitly in the benchmark suite

## Testing Strategy

### Invariant Tests

The first test layer should be invariant-heavy.

Examples:

- parent pointers always match child membership
- visible counts always equal the projection
- canonical `list()` round-trips the tree shape
- flattening does not change canonical topology
- collision handling is deterministic
- directory explicitness behaves correctly
- `move` never creates cycles

### Differential Tests

For many operations it should be possible to compare:

- incremental mutation result
- rebuild-from-list result

This is useful for catching subtle projection and invalidation bugs.

### Stress Tests

Stress tests should prioritize:

- root-adjacent folder moves
- wide-directory visible selection
- flatten chain churn
- async child loads that change flattenability
- large burst transactions
- repeated add/remove/move sequences

## Benchmark Strategy

### Primary Benchmarks

Primary benchmark families should include:

- sorted ingest throughput
- full canonical `list()` materialization
- mutation plus `getVisibleCount()`
- mutation plus `getVisibleSlice(start, end)` for a 200-row window
- cold visible jump to a distant window
- sequential scrolling through windows

The current harness implements these as distinct scenario families:

- warm visible reads against a long-lived store
- cold visible reads against a fresh store per timed sample
- sequential scroll windows with repeated nearby `getVisibleSlice()` calls
- full canonical `list()` materialization against a long-lived store
- end-to-end build plus first/middle window reads

For mutation families, the timed section should measure:

1. apply the mutation
2. read `getVisibleCount()`
3. read `getVisibleSlice(start, end)` using the declared read model

The benchmark should not silently depend on whichever window happened to be
convenient during scenario setup.

### Important Mutation Benchmarks

Do not over-focus on trivial leaf cases.

Important mutation cases include:

- rename file
- move file
- add file
- remove file
- rename deep folder
- rename root-adjacent folder
- move expanded subtree
- recursive delete of large subtree
- large transaction from watcher-like changes

The current harness models these with:

- leaf rename, delete, add, and move
- expand-directory
- root file rename
- root directory rename
- expanded subtree move
- recursive subtree delete
- watcher-style batched visible renames

Large destructive subtree deletes use a fresh store per timed sample because
restoring the deleted subtree is intentionally excluded from the measured path.
Mutation families that can be inverted cheaply still reuse a long-lived store
between samples. Because the destructive delete path must rebuild fresh state,
its sample budget is intentionally lower than the reused-store interactive
mutation scenarios.

For each important mutation, prefer benchmarking both:

- a changed-window read where the edited region is expected to render next
- a preserved-viewport read where the current viewport is far away from the
  edited region

### Secondary Benchmarks

Also measure:

- full canonical `list()` materialization
- sort/prepare throughput for unsorted input
- cleanup/compaction cost
- async child insertion cost

These should inform tradeoffs, but not override the main visible-window target.

### Automated Compare Loop

For optimization loops, the intended inner workflow is:

1. Run a filtered benchmark for the single target scenario.
2. Emit JSON with raw samples.
3. Compare candidate vs baseline offline.

The compare tool should:

- treat one filtered scenario as the primary optimization target
- allow a small guardrail set of nearby scenarios
- report p50 improvement as the main decision signal
- also report p95 improvement as a guardrail
- accept a candidate only when the bootstrap 95% confidence interval for median
  improvement clears the configured minimum effect size

This keeps the inner loop fast while still avoiding noisy one-off wins.

## Prior-Art Alignment

The chosen direction intentionally borrows ideas from several classes of data
structures without copying any one textbook structure wholesale:

- mutable path tries/filesystem trees
- adaptive child indexing for wide nodes
- order-statistics style selection through subtree counts
- projection/view maintenance rather than full rebuilds
- chunked/streamed ingest rather than one monolithic constructor

The main rejected primary directions are:

- global visible-order sequence as the main truth
- persistent transform overlays as the main truth
- canonical flattened nodes

## Implementation Phases

### Phase 1: Canonical Builder and Topology

- segment interning
- numeric IDs
- canonical directory/file nodes
- sorted ingest builder
- canonical `list()`
- explicit vs implicit directory tracking

### Phase 2: Mutable Operations

- `add`
- `remove`
- `move`
- collision policy
- recursive removal semantics
- transaction scaffolding

### Phase 3: Visible Projection

- expansion state
- default expansion policy via `initialExpansion: 'closed' | 'open' | number`
- explicit expansion overrides via `initialExpandedPaths`
- visible subtree counts
- `getVisibleCount()`
- `select(k)` baseline
- `getVisibleSlice(start, end)`

### Phase 4: Adaptive Child Indexes

- width thresholds
- medium-directory chunk summaries
- large-directory indexed aggregates
- visible jump benchmarks

### Phase 5: Flattening Projection

- flatten chain detection
- flattened row payloads
- chain merge/split updates
- flatten-aware visible counts

### Phase 6: Eventing and Invalidations

- semantic operation events
- structural invalidation payloads
- transaction commit events

### Phase 7: Async and Streaming

- child load states
- in-flight load dedupe
- incremental child patching
- worker/cooperative ingest schedulers

### Phase 8: Cleanup and Static Optimizations

- cleanup API
- compaction
- optional static-mode exploration

## Deferred Questions

These are intentionally left open until implementation and benchmarks provide
better evidence:

- exact thresholds for adaptive child index upgrades
- exact aggregate structure used for very large directories
- whether sampled visible anchors are worth adding on top of `select(k)`
- whether a static/read-only mode should build an exact full-path index
- how much path caching should be retained under sustained churn
- whether async child-count hints materially improve real rendering behavior
- whether encoded worker transport materially beats chunked string batches
- whether WASM helps any part of the ingest path in practice

## Guardrails

The implementation should keep the following priorities in order:

1. Correct canonical topology.
2. Correct visible projection for the current policies.
3. Fast interactive mutation plus visible-window reads.
4. Fast ingest.
5. Better full materialization behavior where it does not compromise the above.

When in doubt, prefer the design that keeps:

- subtree moves local
- visible order implicit
- directories stable
- projection separate from canonical truth
