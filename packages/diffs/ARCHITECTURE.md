# How `@pierre/diffs` renders

This is the maintainer's map of the rendering and editing pipeline: which module
owns what, how a render and a keystroke move through them, and the rules the
design depends on. The public API is documented on the docs site; this file is
about the inside.

## The pipeline

```
                 Editor (input, selections, overlays, history, search,
                         prediction, markers, carets)
                   │  applyChange, applyTokens, lineElement
                   ▼
 FileDiff ──── DiffModel ──── RowSource ──── markRow ──── DiffLayout ──── ColumnReconciler ──── DOM
 (shell,       (old lines,    (tokens →      (pair        (rows per       (keyed patch of
  options,      document,      base rows)     ranges)      column)         gutter + content)
  managers)     hunks, pairs)
```

`File` renders a plain file through the same shape with `FileModel`,
`FileLayout` and one column, and no marks.

Value imports flow one way down the table below: a directory uses the ones above
it, never below. Three type-only imports cross the other way and nothing else
does: `layout/` names `DiffHunksRenderer` as the host type of a layout input,
`components/` name the editor's types, and the editor names the component
classes.

| Directory     | Owns                                                                                                                                                                                                  | Does not know                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `model/`      | Text and hunks. `DiffModel` and `FileModel` hold the lines being rendered, `LineMap` gives each line of an edited document a stable id.                                                               | Tokens, rows, the DOM                     |
| `rows/`       | One row at a time. `RowSource` turns tokens or highlight rows into base rows, `markRow` wraps a pair's changed text, `lineDiffRanges` memoizes the word diff.                                         | Hunks beyond one pair                     |
| `layout/`     | The rows of one render. `DiffLayout` and `FileLayout` walk the window and emit a `RowSpec` per row per column, and rebuild single rows after a change that moved none; `RowCells` memoizes the cells. | The DOM                                   |
| `dom/`        | Elements and keys. `ColumnReconciler` is the only code that writes row DOM; `CodeColumns` holds the code elements and their scroll offsets.                                                           | What a row means                          |
| `renderers/`  | Highlighting orchestration: worker pool or local highlighter, result cache, pending results, the edit session's model, and the call into the layout.                                                  | Row DOM                                   |
| `components/` | The shell, options and managers. They decide when to render and are the only callers of the reconciler. The virtualized subclasses add the window.                                                    |                                           |
| `editor/`     | The document and the user: input, selections, overlays, history, search, prediction, clipboard, composition, focus and scroll requests.                                                               | How rows are built or written; hunk rules |

## A read-only render

1. The component asks its renderer for a result. `DiffHunksRenderer.renderDiff`
   finds or requests a highlight result (from the worker pool or the local
   highlighter) and builds a `DiffModel` over the diff with
   `DiffModel.fromDiff`, which never changes the diff it wraps.
2. `RowSource` binds the highlight result's rows: old lines by index, new lines
   by index too for a diff that is not being edited.
3. `DiffLayout.layout` walks the window once with `iterateOverDiff`. In the same
   visit it asks the model which old line a changed line is paired with
   (`pairFor`), takes the base row from the row source, marks it with the pair's
   word diff ranges, stamps the line attributes and builds the gutter cell. Each
   row becomes a `RowSpec`: a key, a gutter cell and a content cell. Cells are
   memoized on their inputs, so an unchanged row gets the same gutter and
   content cell objects as last render; the `RowSpec` wrapper around them is new
   each pass.
4. The component hands each column's specs to that column's `ColumnReconciler`.
   On the first write it sets one string per column. After that it walks the
   specs once against the children: rows whose key is gone are removed, missing
   rows are inserted (contiguous runs as one string), rows that moved are moved,
   rows whose cells changed have their attributes and children patched (a cell
   that kept its children array keeps its markup), and a row whose cells are the
   same objects is not touched. A new highlight result sets `allRowsChanged` and
   the columns are written whole.
5. The reconciler reports which rows changed and whether any row lost the
   attributes set on it from outside, such as selection marks. The component
   then flags the selection for a redraw (after an editor change it flags it
   regardless); the virtualized hosts then reconcile heights: every rendered row
   when wrapping or annotations are on, otherwise only until earlier
   measurements are corrected, and nothing with uniform heights.

Row keys stay the same for as long as the row means the same thing:

| Key                                      | Row                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `a<id>`                                  | A new-file line, by its line id (its index when not editing)                |
| `d<index>`                               | An old-file line, by index; old lines never move                            |
| `ann:<line key>` / `ann:file`            | The annotation row under a line, or the file-level one                      |
| `sep:<column>:<hunk index>`              | A hunk separator (`sep:<slot name>` for a separator slot)                   |
| `buf:<key of the row above>` / `buf:top` | A split-view filler row, hanging off the row above it or opening the column |
| `eof:a` / `eof:d`                        | A "No newline at end of file" marker                                        |
| `inj:<id>` / `inj:<line key>:before:<n>` | A row a host injects, by its id or its place at its anchor                  |

Keying a new line by its id is what makes editing cheap: inserting a line gives
the new row a fresh id while every row below keeps its id and only gets a new
line number.

## An edit session

`Editor.edit(component)` attaches the editor and the component starts a session:
`DiffHunksRenderer.startEditSession` builds a live `DiffModel` with
`DiffModel.startEditSession`, a shallow copy of the input diff that edits change
in place, with a `LineMap` sized to the editor's document. The session's first
render highlights the edited diff again with the token spans the editor reads
and writes the columns whole, unless the rows on screen already carried them;
from then on the reconciler keeps the rows by key.

Rules the model keeps for the whole session:

- The document holds `\n` line breaks only. The file's ending is restored on the
  way out and is not part of undo history.
- `additionLines` has the shape a parse gives it, no entry for the empty line
  after a final line break, with one exception: an empty document keeps a single
  empty entry so the caret has a row. That line is still a document line with an
  id, and the layout renders it as one extra row after the last hunk when that
  region is expanded and the row is inside the window (context when the old file
  ends with a line break too, else an addition), keyed by its id, so the caret
  has a row there. Text typed on it joins the file as a new last entry; emptying
  it again removes the entry. "No newline" marker rows are not rendered while
  editing. `DiffLayout` takes both rules as the inputs `includeTrailingNewline`
  and `showNoNewlineMarkers`, set by the renderer, and
  `computeEstimatedDiffHeights` takes the same two.
- A same-line-count edit copies the changed lines in and keeps the hunks when
  the session rules allow; a line-count edit rereads the document and rebuilds
  the session regions. A region is identified by its old-side range; an edit
  that touches one widens or merges it, and a reverted region stays as context
  until the session ends.
- `finish` recomputes the hunks from the final text the way a plain diff would,
  except that a whitespace-only new side is top-aligned against the old one, and
  keeps expansion at the gap edges that survive. A session that made no edit
  changes nothing.

Colors come from `DiffsEditorTokenizer`, one shape over both backends
(`HighlightsEditorTokenizer`, `ShikiEditorTokenizer`). Every line a backend
colors reaches the component once: with the edit that caused it, with the render
that first shows it (`__prepareRender` flushes the lines about to render), or
through the background delivery. Lines the Highlights backend colors while
priming are dropped when the rows already show them. `RowSource` keeps the
editor's tokens by line id, falls back to the highlight result's row while a
line's text is unchanged, and shows plain text until tokens arrive.

A keystroke is two hops with one DOM writer:

1. The editor applies the edit to its `TextDocument` and calls the component's
   `applyChange(document, change, { tokens, lineAnnotations })`.
2. The component updates the model and binds the tokens, then renders. There is
   one render path; the layout decides how much of it to do. The renderer marks
   the changed lines on the layout (`markLines`) when the model says no row
   moved, and invalidates it when the line count, the hunks or the set of lines
   changed. The next `layout` call rebuilds the marked lines' rows and their
   pairs from the inputs the last walk kept, when every other input is the same
   object as last time, and returns the window with `patched` naming those rows;
   otherwise it walks the window. The component writes the window as always and
   hands `patched` to the reconciler's `reconcile`, which rewrites those rows by
   key instead of walking the columns. A plain component renders at once. A
   virtualized component asks its host for a frame and renders there; nothing
   writes rows outside that frame. Tokens that arrive later (`applyTokens`) mark
   their lines the same way. `applyChange` returns the lines whose rows were
   rebuilt; when there are any, or the line count changed, the editor drops its
   cached row geometry and reads it again as it needs it.

Measured row heights survive a session's structural edit on the virtualized
surfaces: an entry can sit one row off until that row renders and is measured
again, but the heights above and below the viewport add up the same, so nothing
jumps. Rows an edit removed past the end are dropped from the running total. The
exit recompute resets the measurements.

### The editor seam

The editor types the component it edits as the class itself (`File` or
`FileDiff`, with narrowing getters for the diff-only and virtualized-only
calls). There is no interface to implement; nothing outside the package builds
an editable component.

The component gives the editor three methods: `applyChange`, `applyTokens` (for
lines colored in the background) and `lineElement(line)` (the row's element, if
rendered). The editor's attach, resume, completion and state capture go through
the `__`-prefixed hooks on the component, and the editor reaches the host's
scroll through `scrollToLine`, `cancelScroll`, `getLinePosition` and
`isLineRenderable`. Around its DOM write the component calls the editor's
`__`-prefixed hooks: `__captureFocusForDOMReplacement` before rows are written
and `__syncRenderView` after, which redraws the carets and selections and puts
focus back on the rewritten content.

## Scrolling

The host owns programmatic scroll. `Virtualizer` keeps one pending span request
(`scrollSpanIntoView`), advances it after each render and settles or cancels it;
anchoring is skipped while one is pending; wheel, touch, pointer and scroll keys
cancel it through `isUserScrollInput`. `CodeView` funnels `scrollTo` and
`scrollToInstanceLine` through one pending request with an `onDone`, settles it
on the frame with no target left, and cancels on user input or when the target
can no longer be resolved. The editor reveals its caret through the host's
`scrollToLine` and nudges the exact row and column into view once the host
settles.

The edit checkpoint records the view's scroll offsets without reading the DOM:
`CodeColumns` keeps each code column's `scrollLeft` from its scroll events (the
widest column's offset is the component's), and the editor keeps the viewport's
`scrollTop` when it owns the viewport. Restores write the DOM and keep where the
write landed, since a position past the content clamps without a scroll event.

## Server rendering and hydration

`preloadDiffs` and `preloadFile` render through the same renderers and layout.
`renderFullAST` maps each column's specs to cells with `columnCells` and wraps
them in the `code` elements; the shadow root starts with the icon sprite, then
the package's base stylesheet (`createCoreStyleElement`), the theme styles and
any unsafe CSS. On the client, the first render has no row source to compare
against, so it writes the columns whole over the server markup; the reconciler
patches by key from then on. Its `adopt` takes rows already in a column by
position only when a reconciler is created over a result that did not change.

## Performance rules

- A render iterates the diff once in the layout and walks the specs once per
  column in the reconciler. A keystroke that moves no row takes neither walk:
  the layout rebuilds the changed rows from what it kept of the last walk, and
  the reconciler patches them by key. Only a change that moves rows (the line
  count, the hunks, or a batch that removed lines) walks. Marks for lines
  without a row on screen cost one lookup each, since tokens arriving for the
  whole document mark every line. A line keeps its gutter cell through text
  changes (the cell is kept by the line's key), so a keystroke rewrites two
  content cells and nothing else. The walk also records the new-file lines the
  window shows, which the editor's range is taken from while the walk stands, so
  a windowed edit render iterates the diff at most once.
- Every stage of a render keys on what it reads, so a render does only the work
  its inputs call for: the managers are set up again only when the DOM they
  watch changed (the code that wrote it sets the dirty bit), an annotation row
  changed, or what they are set up with changed; the interaction manager takes
  new options itself; the old side's lines keep their array through a session,
  so what is derived from them is kept too.
- A keystroke's checkpoint reads no scroll offsets from the DOM; those come from
  kept values. (A line-count edit in CodeView captures a scroll anchor, which
  reads `scrollTop` if a scroll event left it unread.) The geometry the
  selection overlay needs is cached per line; the cache is dropped when a row
  was rebuilt or the line count changed, and read again as the overlay needs it.
  Row heights are measured in the host's frame.
- Every change to this pipeline is measured before it lands:
  `moonx diffs:benchmark-render` for the synthetic render cases,
  `moonx diffs:benchmark-browser` for the same cases plus keystrokes in real
  Chromium (`--root` compares against another build), and
  `moonx diffs:benchmark-editor-tokenizer` for the tokenizers. Output identical
  to the previous build is a requirement; speed is measured, not estimated.

## Where to look

| To change                                    | Start at                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Which rows a diff shows, separators, buffers | `layout/DiffLayout.ts`, `utils/iterateOverDiff.ts`                                      |
| A row's content or marks                     | `rows/RowSource.ts`, `rows/markRow.ts`                                                  |
| How the DOM is patched                       | `dom/ColumnReconciler.ts`                                                               |
| Session line and hunk rules                  | `model/DiffModel.ts`, `utils/editSessionHunks.ts`                                       |
| Highlighting, worker pool, result cache      | `renderers/DiffHunksRenderer.ts`                                                        |
| Editor tokens on both backends               | `highlighter/DiffsEditorTokenizer.ts`                                                   |
| Window, heights, CodeView items              | `components/VirtualizedFileDiff.ts`, `CodeView.ts`                                      |
| Scroll requests                              | `components/Virtualizer.ts`, `CodeView.ts`                                              |
| The editor's host calls                      | `editor/editor.ts`, `components/FileDiff.ts`                                            |
| What a keystroke rewrites                    | `layout/DiffLayout.ts` (`markLines`, `layout`), `dom/ColumnReconciler.ts` (`reconcile`) |
