# monaco-legacy-tests

Behavioral test scenarios harvested from the Monaco editor's core test suite and
re-expressed against `@pierre/diffs`' edit APIs. Scope: text editing, selection
& multi-cursor, and undo/redo. IME/composition scenarios are deferred.

## Provenance & attribution

Monaco's editor core lives in
[microsoft/vscode](https://github.com/microsoft/vscode) (the `monaco-editor`
repo is packaging only). Scenarios here were adapted from vscode's test suite at
commit `86f5a62f058e3905f74a9fa65d04b2f3b533408e` (the `vscodeRef` pinned by
monaco-editor at the time of the audit). vscode is MIT-licensed, © Microsoft
Corporation.

These are behavioral rewrites, not code copies: each test re-expresses a
scenario (input text, operation, expected text/selections) in this package's own
test idiom. Every test carries a traceability comment:

```ts
// monaco-legacy: src/vs/editor/test/common/model/textModel.test.ts — "<original test name>"
```

## Conventions

- vscode positions are 1-based (`line`/`column`); ours are 0-based LSP-style
  (`line`/`character`). All coordinates here are already translated.
- `test.failing(...)` marks a **known bug**: the test encodes the _correct_
  expected behavior and currently fails. When the bug is fixed, `bun test` will
  report the test as unexpectedly passing — remove the `.failing` modifier then.
- `DIVERGENCE:` comments mark places where `@pierre/diffs` intentionally (or at
  least knowingly) behaves differently from vscode. Those tests pin _our_
  behavior and document the difference; they are decisions, not bugs.

## Known bugs encoded as `test.failing` (10)

**EditStack coalescing** (`editStack.monaco.test.ts`, 3) — root cause:
`shouldCoalesceEditStackEntry()` in `src/editor/editStack.ts` compares a new
edit against whatever entry sits on top of the undo stack, purely by geometry,
with no state reset after `undo()`/`redo()`.

1. After `undo()` pops an entry, new typing can coalesce with the newly exposed
   (pre-undo) top entry, fusing old history into the new edit.
2. `undoBoundary` entries stop blocking merges once they are undone.
3. Backspace followed by forward-delete at the same pivot coalesces into one
   undo step (vscode guarantees an undo stop when delete direction flips).

**Surrogate-pair edit boundaries** (`applyEdits.monaco.test.ts`, 3) — edit range
endpoints landing strictly inside a surrogate pair split the pair and corrupt
the buffer; vscode auto-widens/snaps such ranges to pair boundaries. Affects
insert inside a pair and replaces starting or ending inside one (`TextDocument`
`#resolveEdit`/`normalizePosition` have no surrogate-aware clamping).

**PieceTable CRLF line metadata** (`pieceTable.monaco.test.ts`, 4) — line-break
bookkeeping goes stale when a `\r\n` pair is split or assembled across edits:
deleting exactly the `\n` of a pair, inserting between the `\r` and `\n`,
assembling `\r\n` from two separate inserts, plus a CRLF-biased fuzz oracle that
catches the general class. Text content (`getText()`) stays correct;
`lineCount`/`positionAt` metadata does not.

## Consciously out of scope (missing features, not missing tests)

vscode has extensive tests for these; if the feature is ever built, start from
the referenced suites:

- Forward word-delete family (`DeleteWordRight`, `DeleteWordStartRight`,
  `DeleteWordEndRight`) —
  `src/vs/editor/contrib/wordOperations/test/browser/wordOperations.test.ts`
- Vim-style `deleteInsideWord` — same file
- `JoinLines` (Ctrl+J) whitespace-collapsing semantics —
  `src/vs/editor/contrib/linesOperations/test/browser/linesOperations.test.ts`
- Transpose crossing _forward_ over a line break at end-of-line
  (`applyTransposeToSelections` has no forward-crossing branch) —
  `linesOperations.test.ts` TransposeAction suite
- IME composition ↔ undo-coalescing interaction (deferred with the rest of IME)
- Vertical cursor movement preserving the _visual_ column across full-width CJK
  lines (vscode issue #22717) — exercises `#lastAccessedCharX` in `editor.ts`
  and `moveBySoftLine`, which need canvas text-measure stubbing; deferred, not
  skipped on merit
