# @pierre/diffs tests

Run from this package directory:

```bash
AGENT=1 bun test
```

## Conventions

- Shared DOM bootstrap lives in `domHarness.ts` (`installDom` always installs
  the same superset of globals — per-file subsets drifted in the past).
- Shared assertion/projection helpers live in `testUtils.ts`. Prefer asserting
  behavioral projections (`projectColumn`, `rowDigests`, `hunkDigest`,
  `annotationProjection`) over snapshotting whole render results.
- Snapshot policy: `FileRenderer.test.ts` holds the suite's single full-fidelity
  highlighted-AST snapshot (the token/style canary). Every other snapshot should
  be a compact projection of just the behavior its test owns, small enough to
  review line by line. When a snapshot fails, read the diff — do not reflexively
  `bun test -u`.
- `test.failing(...)` marks a **known bug**: the test encodes the _correct_
  expected behavior and currently fails. When the bug is fixed, `bun test` will
  report the test as unexpectedly passing — remove the `.failing` modifier then.
  `DIVERGENCE:` comments pin places where this package intentionally (or at
  least knowingly) behaves differently from an alternative it was compared
  against; those tests pin _our_ behavior and document the difference — they are
  decisions, not bugs. `KNOWN BUG:` comments accompany every `test.failing` with
  the root cause.

## Provenance

A set of behavioral scenarios in this suite was derived by auditing the test
suites of other open-source editors — microsoft/vscode @
`86f5a62f058e3905f74a9fa65d04b2f3b533408e`, CodeMirror 6
(`state@9c801279cb83011e6f92af778f4443406e8f1200`,
`commands@5b9bac974f2c4af3e20b045adef949667872ecad`), and
atom/text-buffer@`b1f093269b175ce6cc9728c7a4d50ca75bb031b6` +
atom/superstring@`6732087fac04cd68d14e93d4f83f246879200ab5` (all MIT) — as
behavioral rewrites with original names, fixtures, helpers, and granularity; no
code was copied. Future derivations must use permissively-licensed sources only
and follow the same rewrite discipline.

## Known coverage gaps (confirmed by the 2026-06 test audit)

Important behaviors that currently have no direct tests, in rough priority
order. If you touch one of these areas, consider adding the missing coverage:

- **WorkerPoolManager pipeline** (`src/worker/WorkerPoolManager.ts`): task
  routing, result caching by cacheKey, stale-response gating after
  `setRenderOptions`, error fallback freeing the worker, init-failure fallback
  to the shared highlighter. Only the terminate-during-initialize paths are
  tested.
- **SSR → hydrate round trip** (`src/ssr/preloadDiffs.ts`): none of the five
  preload entry points is imported by any test, and `hydrate()` never runs
  against real prerendered HTML (hydration.test.ts uses purpose-built fakes).
- **ScrollSyncManager**: split-diff horizontal scroll synchronization.
- **Virtualizer / ReducedVirtualizer** (`src/managers/`): the real scroll
  window, visibility, and height-reconciliation anchoring (component tests stub
  the virtualizer).
- **Mouse-driven line selection** (`src/managers/InteractionManager.ts`): drag,
  shift-click extension, single-line unselect.
- **getFiletypeFromFileName**: filename → language detection and the custom
  extension registry.
- **shiki-stream** (`src/shiki-stream/`): publicly exported streaming tokenizer
  with chunk-boundary/grammar-state logic, zero tests.
- **UnresolvedFile** merge-conflict click-to-resolve wiring.
- **Interaction option updates, disable direction**: only the enable direction
  of `setOptions` interaction toggles is covered.
- **getMeasuredScrollbarGutter**: the namesake measurement function of the
  scrollbar-gutter CSS helpers.
- **createFileHeaderElement**: diff metadata counts and change-type rendering
  branches.
- **DOM virtualization buffers** (`data-virtualizer-buffer`): created by
  File/FileDiff `applyBuffers` on live DOM; no test asserts them anywhere.
- **Forward word-delete family** (delete-word-right, delete-word-start-right)
  and **deleteInsideWord** — no equivalent commands exist yet.
- **Line-join whitespace collapsing** — a "join lines" command that collapses
  the whitespace at the join point is not implemented.
- **Forward transpose at end-of-line** — transposing characters across a line
  break in the forward direction has no implementation.
- **CJK visual-column vertical movement** — vertical caret movement does not
  preserve the visual column across full-width CJK characters (requires canvas
  text-measure stubbing to test properly).
- **Preferred line-ending override** — no setter/option lets a host force an
  LF/CRLF policy for inserted text; line ending is a derived getter only.
- **Range-scoped search** — search params have no range field; selection-scoped
  find/replace is not possible today.
- **Multi-line pattern search** — the piece-table search rejects patterns
  containing line breaks; matching across line breaks is unsupported.
- **Transactions, checkpoints, and retroactive change grouping** — no
  `transact()`/nested-transaction/abort API, no checkpoint/revert-to-checkpoint
  concept, and no public API to retroactively merge the last N history entries;
  history grouping today is purely geometric typing-coalescing plus an
  undo-boundary marker.
- **Edit-tracking markers with invalidation strategies** — markers are
  render-only today; there is no remapping of marker positions through edits
  with configurable invalidation strategies.
- **Soft-wrap continuation-row hanging indent** — wrapped continuation rows do
  not support a hanging indent.
- **Time-based undo grouping** — undo coalescing is geometry-based with no clock
  input; a `newGroupDelay`-style time window is a policy decision, not
  implemented.
- **IME composition deferrals** — IME/composition interaction with editing and
  undo-coalescing is deferred and not covered.

## Known bugs pinned as `test.failing` (16)

- **EditStack coalescing** (3) — coalescing decisions compare a new edit against
  whatever sits on top of the undo stack purely by geometry, with no state reset
  after undo/redo: an undo can expose a stale top entry that new typing then
  fuses into; an undo-boundary marker stops blocking merges once it is undone;
  and backspace followed by forward-delete at the same pivot coalesces into a
  single undo step instead of getting an undo stop when the delete direction
  flips.
- **PieceTable CRLF line metadata** (5, spanning piece-table and search
  coverage) — line-break bookkeeping goes stale when a CRLF pair is split or
  assembled across edits (deleting exactly the `\n` of a pair, inserting between
  the `\r` and `\n`, assembling CRLF from two separate inserts, plus a
  CRLF-biased fuzz oracle), and the same stale metadata drives search astray
  (shifted or missing match ranges) even though `getText()` stays correct.
- **Batch edit ordering sensitivity** (1) — accepting a batch containing a
  delete and an insert at the same offset depends on the caller's array order:
  delete-first throws an overlap error, insert-first succeeds.
- **History equivalence across non-history edits** (7) — edits applied with
  `updateHistory=false` are an implementation detail of how an edit reaches
  `applyEdits`, not a separate semantic class: a mixed programmatic/local
  sequence must leave history equivalent to the same sequence applied all-local,
  so undo-to-exhaustion restores the original byte-exact text and
  redo-to-exhaustion the final text. Today untracked edits bypass the edit stack
  and existing entries apply at stale offsets, so exhaustion corrupts instead: a
  stale-offset undo deletes the wrong characters, a replacement batch breaks
  across an interleaved untracked insert, an untracked interior insert is erased
  while tracked text is stranded, an untracked whole-document replace produces
  spliced states that never existed on any timeline, typing coalesced around an
  untracked insert unwinds to the untracked remainder instead of the original
  text, the unwind that should restore recorded selections verbatim never
  reaches the original text, and a pending redo survives an untracked edit
  (instead of being cleared like any new edit) and replays at stale offsets.
