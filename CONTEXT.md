# Path-Store Trees Rewrite

Shared language for the path-store-powered trees rewrite inside this repo. This
glossary exists to keep planning and implementation aligned on the distinct
loading and ingest modes the new trees product must support.

## Language

**Path-Store Tree**: The new `@pierre/trees` product lane whose canonical
runtime is backed directly by `@pierre/path-store`. _Avoid_: legacy tree, old
core tree

**Synchronous Ingest**: One-shot construction of a tree from a complete path
set, preferred for ordinary workloads that comfortably fit the main-thread
budget. _Avoid_: normal loading, default async loading

**Reveal Loading**: Directory-scoped loading that fetches or applies children
when a folder becomes relevant to the user, usually around expansion or imminent
visibility. _Avoid_: lazy loading, subtree hydration

**Cooperative Bulk Ingest**: Progressive construction of a very large tree in
small slices so the UI stays responsive while a large snapshot is still being
applied. _Avoid_: lazy loading, streaming

**Streaming Transport**: Incremental delivery of path data so the client can
begin decode and ingest work before the entire snapshot has arrived. _Avoid_:
cooperative ingest, reveal loading

**Controller Async Surface**: The vanilla path-store trees controller owns async
loading state and actions, while file-tree wrappers, demos, and React bindings
observe or forward that controller contract. _Avoid_: wrapper-only async API,
demo-owned loading contract

**Reveal Loading Policy**: The controller ships a built-in default policy for
when to load and prefetch revealed subtrees, but callers may replace that policy
when a workload needs different behavior. _Avoid_: demo-only prefetch logic,
fixed non-configurable scheduler behavior

**Async Data Source**: Callers supply the transport and data-source callbacks
that produce subtree payloads or large-snapshot chunks, while the controller
owns when to invoke them, cancellation, and apply orchestration. _Avoid_:
controller-owned HTTP/WebSocket assumptions, transport baked into product
behavior

**Row Async State**: Visible tree rows expose their directory loading state
directly so renderers can show loading, unloaded, or error status without extra
controller lookups. _Avoid_: hidden side-table state for basic row rendering,
row models that omit known async truth

**Async Lifecycle Events**: Loading emits a first-class event stream distinct
from mutation events so callers can observe request starts, incremental patch
application, completion, failure, and retries without inferring them from row
snapshots. _Avoid_: folding loading into mutation events, rendering-only
observability

**Directory Snapshot**: Reveal-loading callbacks return a path-first description
of a directory's known children rather than raw low-level patch operations; the
controller translates that snapshot into internal patch application. _Avoid_:
exposing PathStoreChildPatch as the default caller contract, low-level patch
programming for ordinary loaders

**Sorted Bulk Chunk**: Cooperative bulk-ingest sources emit globally sorted
canonical path chunks so the controller can ingest incrementally without
buffering the whole dataset first. _Avoid_: unsorted bulk chunks, "we'll sort
later" contracts

**Trees-Facing Ingest Surface**: Cooperative bulk-ingest may depend on an
incremental builder implemented in `@pierre/path-store`, but any contract that
trees consumers implement against must be wrapped or re-exported through
`@pierre/trees`. _Avoid_: requiring end users to reach into an unpublished
`@pierre/path-store` package

**Trees Bulk-Ingest Facade**: Consumers start and observe cooperative
bulk-ingest through a trees-owned facade, even when the implementation delegates
to a lower-level path-store builder internally. _Avoid_: exposing the raw
path-store builder as the primary trees contract

**Live Model Upgrade**: Cooperative bulk-ingest normally upgrades a stable
controller or file-tree instance in place so subscriptions, composition, and
model identity remain intact. _Avoid_: replacement-model churn for ordinary
bulk-ingest progress

**Hard Reset**: A deliberate mode on the same in-place replacement surface that
clears retained interaction state and swaps the underlying tree when the caller
is changing to a fundamentally different dataset, such as moving from one repo
to another. _Avoid_: forcing callers to construct a brand-new FileTree instance
just to drop old state, or inventing a separate reset method for the same
replacement seam

**Checkpoint Cadence**: The controller-owned bulk-ingest facade publishes
controlled progress checkpoints to the live model instead of exposing every
internal append chunk immediately. _Avoid_: per-chunk rerender thrash, end-only
publication that hides useful progressive work

**Reservation Hint**: Optional metadata such as `knownChildCount` lets the
controller reserve space once to reduce viewport jumpiness as async data
arrives; `knownChildCount` counts direct child entries only, and the tree
remains correct when the hint is absent. _Avoid_: making reservation metadata
mandatory for correctness, overloading `knownChildCount` with visible-row
semantics, or ignoring it when good UX depends on it

## Relationships

- A **Path-Store Tree** may start through **Synchronous Ingest**, **Reveal
  Loading**, or **Cooperative Bulk Ingest**.
- **Reveal Loading** grows a specific directory subtree; it does not imply
  possession of the whole dataset.
- **Cooperative Bulk Ingest** describes how a large snapshot is applied on the
  client; it may consume either an already-downloaded dataset or streamed
  chunks.
- **Reveal Loading** may insert sorted directory contents into the middle of the
  existing global order; that is normal subtree growth, not a violation of the
  bulk-ingest ordering contract.
- **Reservation Hint** is recommended when the data source can provide it
  because it improves scroll stability and reduces one-time layout jumps as
  content fills in.
- **Streaming Transport** is a delivery strategy, not a loading mode by itself.
- **Streaming Transport** may feed **Cooperative Bulk Ingest** and is an
  important end-goal, but it is not a hard first-pass constraint.
- **Synchronous Ingest** remains the preferred baseline when the dataset size
  does not justify progressive work.

## Example dialogue

> **Dev:** "The AOSP case is loading lazily, right?" **Domain expert:** "Be
> precise. Expanding folders on demand is **Reveal Loading**. Receiving the
> whole AOSP snapshot and applying it over many frames is **Cooperative Bulk
> Ingest**. For smaller workloads we still want **Synchronous Ingest**."

## Flagged ambiguities

- "loading" was being used to mean both **Reveal Loading** and **Cooperative
  Bulk Ingest** — resolved: these are distinct modes.
- "canonical model" was ambiguous between the path-store primitive set and the
  trees product surface — resolved: the trees product must keep multiple modes
  rather than collapsing them into one public loading contract.
- "async API" was ambiguous between controller, wrapper, and demo
  responsibilities — resolved: the **Controller Async Surface** belongs to the
  vanilla controller layer and higher-level wrappers build on top of it.
- "loading policy" was ambiguous between product behavior and app-specific glue
  — resolved: the controller owns a default **Reveal Loading Policy**, but
  callers may replace it.
- "data source" was ambiguous between controller policy and transport
  implementation — resolved: the controller owns orchestration, while callers
  supply the **Async Data Source**.
- "row async state" was ambiguous between inline row fields and external lookup
  tables — resolved: async state belongs on visible rows, with an explicit note
  to watch the performance cost of that representation during ingestion.
- "public builder dependency" was ambiguous between an internal path-store
  primitive and the consumer contract — resolved: the builder may live in
  path-store, but the consumer-facing surface must come from **@pierre/trees**
  via wrapping or re-export.
- "async observability" was ambiguous between row snapshots and event streams —
  resolved: row snapshots serve rendering, while **Async Lifecycle Events**
  serve logging, testing, metrics, and orchestration visibility.
- "reveal payload" was ambiguous between path-first directory contents and
  low-level patch operations — resolved: caller-facing reveal loaders return a
  **Directory Snapshot**, and the controller performs the translation.
- "bulk ordering" was ambiguous between cooperative whole-snapshot ingest and
  subtree reveal insertion — resolved: **Cooperative Bulk Ingest** requires
  **Sorted Bulk Chunk** input, while **Reveal Loading** may populate a subtree
  that sits in the middle of the already-sorted tree.
- "bulk-ingest surface" was ambiguous between internal builder mechanics and the
  consumer contract — resolved: consumers bind to a **Trees Bulk-Ingest
  Facade**, not to the raw path-store builder.
- "reset" was ambiguous between progressive in-place upgrade and switching to a
  totally different tree — resolved: ordinary cooperative progress uses **Live
  Model Upgrade**, while unrelated dataset changes may use **Hard Reset**
  without changing the public model identity.
- "hard reset API shape" was ambiguous between an options mode and a separate
  method — resolved: **Hard Reset** is an explicit mode on the same in-place
  replacement surface.
- "bulk publish cadence" was ambiguous between append chunks and user-visible
  progress — resolved: **Checkpoint Cadence** belongs to the controller/facade,
  not to each internal chunk.

- "reservation hint" was ambiguous between optional UX metadata and a
  correctness requirement — resolved: **Reservation Hint** is optional but
  recommended when available.
- "knownChildCount" was ambiguous between direct child entries and UI-derived
  visible rows — resolved: it counts direct child entries only; any future
  visible-row reservation hint would be a separate concept.
- "retry policy" was ambiguous between failed background work and explicit user intent — resolved: the default reveal-loading policy auto-retries when the user explicitly expands a folder after a failed background prefetch.
