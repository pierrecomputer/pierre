# codemirror-legacy-tests

Behavioral test scenarios harvested from CodeMirror 6's test suites and
re-expressed against `@pierre/diffs`' edit APIs. Companion to
`../monaco-legacy-tests/` (same conventions); scenarios already covered there or
in the main suite were filtered out during the audit. Scope: text buffer/rope
semantics, edit application and position remapping, selection & multi-cursor,
undo/redo. IME/composition remains deferred.

## Provenance & attribution

Adapted from the MIT-licensed CodeMirror packages, © Marijn Haverbeke and
others:

- [codemirror/state](https://github.com/codemirror/state) @
  `9c801279cb83011e6f92af778f4443406e8f1200` (`test-text.ts`, `test-change.ts`,
  `test-selection.ts`, `test-state.ts`, `test-charcategory.ts`)
- [codemirror/commands](https://github.com/codemirror/commands) @
  `5b9bac974f2c4af3e20b045adef949667872ecad` (`test-history.ts`,
  `test-commands.ts`)

These are behavioral rewrites, not code copies. CodeMirror addresses documents
by flat offsets and anchor/head selections; everything here is translated to
this package's 0-based `{line, character}` positions and `EditorSelection`
ranges. Traceability comment on every test:

```ts
// codemirror-legacy: cm-state/test/test-change.ts — "<original test name>"
```

## Conventions

Same as `../monaco-legacy-tests/README.md`:

- `test.failing(...)` = known bug; the test asserts the _correct_ behavior and
  currently fails. Remove the modifier when the bug is fixed.
- `DIVERGENCE:` comments pin intentional/accepted differences from CodeMirror.

## Known bugs encoded as `test.failing`

12 tests, full details in each file's `KNOWN BUG` comment:

- `applyEditsBatch.cm.test.ts` (1): acceptance of a {delete,
  insert-at-same-offset} batch depends on the caller's array order —
  delete-first throws 'Overlapping text edits are not supported', insert-first
  succeeds.
- `commands.cm.test.ts` (3): the line-indent dispatch concatenates per-selection
  edits with no shared-line dedupe, so a line under two carets/ranges indents
  twice; the outdent variant emits two identical deletes that fail overlap
  validation and the whole command throws.
- `historyRemote.cm.test.ts` (6): one root cause — EditStack entries are frozen
  at creation and never remapped through non-history (`updateHistory=false`)
  edits. Surfaces pinned: stale-offset undo corrupting remote text, undo of a
  wiped entry not being a graceful no-op, batch inversion across an interleaved
  remote insert, interior remote inserts not surviving undo of a tracked
  insertion, stored entry selections restored without remapping, and redo
  replaying at stale offsets.
- `pieceTable.cm.test.ts` (1): `TextDocument.positionAt` can return a position
  strictly inside a CRLF pair (character beyond `getLineLength`) that its own
  `offsetAt` clamps away, so the round trip silently loses a column.
- `selection.cm.test.ts` (1): `Editor.setSelections` normalizes positions but
  never reorders a start-after-end pair, storing an inverted selection that
  violates the `start <= end` invariant downstream code assumes.

## Consciously out of scope

- Forward word/group delete (`deleteGroupForward`) — missing feature, already
  recorded in `../monaco-legacy-tests/README.md`; CodeMirror's newline-boundary
  rules for it (`cm-commands/test/test-commands.ts`) are the reference if built.
- History entries mapping through _concurrent non-history edits_ (CodeMirror's
  remote-change rebasing: preserving interior inserts on undo, remapping stored
  selections through unrecorded edits, redo surviving non-history edits). Where
  the current behavior is merely _different but safe_ it is pinned as
  DIVERGENCE; where it corrupts text through plausible public-API flows it is
  encoded as a known bug; full collab-style rebasing is a non-goal.
- Time-based undo grouping (`newGroupDelay`) — pierre-fe's coalescing is
  geometry-based with no clock input; policy decision, not ported.
- IME composition scenarios (deferred with the rest of IME).
