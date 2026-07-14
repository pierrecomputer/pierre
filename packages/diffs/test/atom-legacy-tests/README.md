# atom-legacy-tests

Behavioral test scenarios harvested from Atom's text-layer test suites and
re-expressed against `@pierre/diffs`' edit APIs. Companion to
`../monaco-legacy-tests/` and `../codemirror-legacy-tests/` (same conventions);
scenarios covered there or in the main suite were filtered out during the audit.

## Provenance & attribution

Adapted from the MIT-licensed Atom packages, © GitHub Inc.:

- [atom/text-buffer](https://github.com/atom/text-buffer) @
  `b1f093269b175ce6cc9728c7a4d50ca75bb031b6`
  (`spec/text-buffer-spec.coffee`/`.js`, `spec/marker-spec.coffee`,
  `spec/marker-layer-spec.coffee`, `spec/display-layer-spec.js`)
- [atom/superstring](https://github.com/atom/superstring) @
  `6732087fac04cd68d14e93d4f83f246879200ab5` (`test/js/patch.test.js`,
  `test/js/text-buffer.test.js`)

These are behavioral rewrites, not code copies: original test names, fixtures,
helpers, and assertions; organized by this package's architecture rather than
the source suites' layout; granularity re-derived around our API. Every test
carries a traceability comment:

```ts
// atom-legacy: atom-text-buffer/spec/text-buffer-spec.coffee — "<original test name>"
```

## Conventions

Same as the sibling suites: `test.failing(...)` = known bug asserting correct
behavior (remove the modifier when fixed); `DIVERGENCE:` comments pin
intentional differences from Atom.

## Known bugs encoded as `test.failing` (8)

**Search-replace capture expansion with lookaround**
(`searchReplace.atom.test.ts`, 3) — root cause: `buildSearchReplacementText`
re-executes the pattern against only the matched slice, so lookaround context
outside the slice is lost.

1. A lookbehind's context sits before the slice; the re-execution finds nothing,
   falls back to the raw replace text, and the literal `$1` is inserted into the
   document.
2. A lookahead's context sits after the slice — same fallback, unexpanded
   replace text inserted.
3. A lookahead that re-matches _shorter_ on the slice (the trailing context
   character is part of the slice) trips the full-length guard and the literal
   `$&` is inserted.

**PieceTable CRLF line metadata drives search astray**
(`searchReplace.atom.test.ts`, 1) — splices that split or form `\r\n` pairs
across piece seams corrupt the piece-level line-break counts, so line starts
drift and search reports shifted or missing ranges even though `getText()` stays
correct; a replace driven by those ranges would edit the wrong bytes. Root cause
pinned as directed repros in `../monaco-legacy-tests/pieceTable.monaco.test.ts`.

**Soft-wrap vertical motion splits surrogate pairs**
(`softWrap.atom.test.ts`, 2) — `moveBySoftLine` computes the landing spot as
target-segment start + visual column in raw UTF-16 units with no
grapheme/surrogate snapping, so ArrowDown into a continuation row (and ArrowUp
across a logical-line boundary) can park the caret between the halves of an
astral character; a subsequent insert at that caret splits the pair into lone
surrogates.

**Malformed position components destroy the document**
(`positions.atom.test.ts`, 2) — `normalizePosition` has no finiteness/integer
guard, so a `NaN` (or fractional) `line`/`character` flows through
`Math.min`/`Math.max` into `offsetAt`, the resolved offset becomes `NaN`, and
the degenerate range resolves to a whole-document replace: an insert with one
malformed component silently erases everything else. Atom throws `Invalid Point`
on such input. (`Infinity` happens to clamp to a valid offset today — pinned as
a DIVERGENCE.)

## Intentional divergences (`DIVERGENCE:` comments, 8)

`searchReplace.atom.test.ts` (5): `$0`/out-of-range capture references resolve
via `match[n] ?? ''` instead of staying literal; zero-length matches are
suppressed (starred patterns and bare `^`/`$` anchors report nothing where Atom
reports empty ranges — two comments); invalid patterns yield zero matches
instead of throwing; panel-driven replace wraps around VS Code-style rather than
stopping at the buffer end. `history.atom.test.ts` (1): every recorded history
step clears redo — no-op transactions are not dropped.
`selectionRemap.atom.test.ts` (1): uniform right gravity at an edit that starts
exactly at a selection start (Atom's marker bias would absorb the new text).
`softWrap.atom.test.ts` (1): no clamp to the final wrap segment's end when
moving up into a shorter last segment — the overshoot acts as an implicit goal
column.

## Missing features surfaced by this audit (recorded, not tested)

Atom has dedicated coverage for all of these; candidates for the feature backlog
rather than this suite:

- **Preferred line-ending override** — `TextDocument.eol` is a derived getter
  (first line break); no setter/option lets a host force LF/CRLF policy for
  inserted text
- **Range-scoped search** — `SearchParams` has no range field; selection-scoped
  find/replace is impossible today
- **Multi-line pattern search** — `PieceTable.search` rejects patterns
  containing `\n`/`\r`; matching across line breaks is unsupported (the
  rejection itself is pinned in `editorPieceTable.test.ts`)
- **Transactions** — no `transact()`/nested-transaction/abort API; EditStack
  groups only via geometric typing coalescing and `undoBoundary`
- **History checkpoints** — no checkpoint/revert-to-checkpoint concept
- **Retroactive change grouping** — no public `groupLastChanges()`-style merge
  of the last N history entries
- **Edit-tracking markers with invalidation strategies** — `Marker` is
  render-only; no remapping through edits (marker _bias_ scenarios that map onto
  selection remapping are tested here; the marker feature itself is not)
- **Soft-wrap continuation-row hanging indent**
