# textmate-legacy-tests

Behavioral test scenarios identified by auditing TextMate 2's test suite and
written from scratch against `@pierre/diffs`' edit APIs. Companion to
`../monaco-legacy-tests/` and `../codemirror-legacy-tests/` (same conventions);
scenarios covered there or in the main suite were filtered out during the audit.

## Provenance & licensing

The audit read the test suites of
[textmate/textmate](https://github.com/textmate/textmate) at commit
`346b52b108b387462d4b3def481fb74983ae89f3`. TextMate 2 is **GPL-3.0** (© Allan
Odgaard and contributors) — unlike the MIT sources of the sibling suites.
Accordingly, this suite contains **no TextMate source code, fixtures, or adapted
expression of any kind**: the audit extracted behavioral contracts (operation,
input shape, expected outcome) as plain-language descriptions, and every test
here was authored fresh against those descriptions with original fixtures,
asserting pierre-fe's own intended behavior. Traceability comments cite the
TextMate test _file_ that motivated a scenario, for auditability:

```ts
// textmate-legacy: Frameworks/selection/tests/t_find.cc — caret-relative find seeding
```

## Conventions

Same as the sibling suites: `test.failing(...)` = known bug asserting correct
behavior; `DIVERGENCE:` comments pin intentional differences (here: differences
from classic macOS/TextMate conventions, which this library may or may not want
to follow — each is a product decision).

## Known bugs encoded as `test.failing`

1. **Block indent dirties blank and whitespace-only lines**
   (`wrapIndent.tm.test.ts`) — `resolveIndentEdits` inserts the indent unit on
   every line of a multi-line selection, including empty and whitespace-only
   lines, injecting trailing whitespace on lines the user never touched.

`DIVERGENCE:` markers (6 total): smart-home hop direction from inside the
indentation, repeated-press toggle order, whitespace-only-line home stop,
shift+home stop order, and the no-`Intl.Segmenter` word-expansion fallback
clipping a word at a combining mark (`movementWords.tm.test.ts`), plus emoji
neighbors blocking whole-word search matches (`findSearch.tm.test.ts`).

## Missing features surfaced by this audit (recorded, not tested)

TextMate has dedicated coverage for all of these; none exist in pierre-fe today.
Candidates for the feature backlog rather than this suite:

- **Subword / camel-hump movement & deletion** — caret units inside identifiers
  (camelCase humps, ALLCAPS acronym runs, underscore asymmetry, digit
  separators)
- **Select-to-enclosing-bracket-pair / jump-to-matching-bracket** —
  `matchBrackets.ts` only highlights; no selection/movement command uses it
- **Select-all-occurrences** — `findNexMatch` adds one match at a time; no
  select-all-matches command
- **Move-to-column-block-edge** — vertical jump to the edge of the contiguous
  block where the current column exists (distinct from goal-column, which
  exists)
- **Edit-tracking marks/bookmarks** — `Marker` is render-only; no remapping
  through edits, no next/prev-mark navigation
- **Soft-wrap continuation-row hanging indent**
- **Multi-cursor copy/paste distribution** (paste handler TODO at `editor.ts`
  ~line 1478) and **indent-adjusted paste**
- **Clipboard history ring** (paste-previous / paste-next)
- **Case transforms** (upper/lower/capitalize selection actions)
- IME composition scenarios remain deferred suite-wide
