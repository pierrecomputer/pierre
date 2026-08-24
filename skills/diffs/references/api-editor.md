# Editor API

This reference lists the primary exports from `@pierre/diffs/edit` and the
editor APIs used by common integrations.

## Exports

| Export               | Kind  | Purpose                                                  |
| -------------------- | ----- | -------------------------------------------------------- |
| `Editor`             | Class | Adds text editing to a `File` or `FileDiff` instance.    |
| `EditorChange`       | Type  | Describes one normalized editor change.                  |
| `EditorChangeEvent`  | Type  | Provides normalized edits and current document state.    |
| `EditorCommand`      | Type  | Names an editor command.                                 |
| `EditorDocumentKind` | Type  | Selects a `file` or `file-diff` editor surface.          |
| `EditorFocusOptions` | Type  | Selects a focus target and scroll behavior.              |
| `EditorKeymap`       | Type  | Defines ordered custom shortcut groups.                  |
| `EditorOptions`      | Type  | Configures history, initial state, behavior, and events. |
| `EditorShortcut`     | Type  | Defines one command shortcut.                            |
| `EditorState`        | Type  | Holds selections and editor-owned viewport offsets.      |
| `KeyboardKey`        | Type  | Names a key accepted by an editor shortcut.              |
| `KeyboardModifier`   | Type  | Names a modifier accepted by an editor shortcut.         |
| `TextDocument`       | Class | Stores text, positions, edits, search, and undo history. |
| `TextDocumentChange` | Type  | Describes the lines and characters changed by an edit.   |
| `Position`           | Type  | Identifies a zero-based line and character.              |
| `Range`              | Type  | Identifies a start and end position.                     |
| `TextEdit`           | Type  | Replaces one range with new text.                        |

## `EditorOptions` fields

| Field                    | Purpose                                                  |
| ------------------------ | -------------------------------------------------------- |
| `historyMaxEntries`      | Limits the undo stack.                                   |
| `initialState`           | Applies selections and view state once on first attach.  |
| `keymap`                 | Adds shortcut groups checked before the defaults.        |
| `roundedSelection`       | Controls rounded selection corners.                      |
| `matchBrackets`          | Controls matching-bracket highlights.                    |
| `autoSurround`           | Controls quote and bracket insertion around a selection. |
| `languageCommentConfig`  | Overrides comment tokens by language.                    |
| `enabledSelectionAction` | Enables the selection action surface.                    |
| `clipboard`              | Supplies a text clipboard reader.                        |
| `renderSelectionAction`  | Produces the selection action element.                   |
| `onAttach`               | Receives the editor and attached surface.                |
| `onChange`               | Receives the complete `EditorChangeEvent`.               |
| `onFocus`                | Runs after the editor gains focus.                       |
| `onBlur`                 | Runs after the editor loses focus.                       |

`initialState` is captured when the `Editor` is created and consumed after its
first successful attach. Updating options later does not queue it again. State
from change or completion events belongs to the application; pass it as
`initialState` to a newly created editor, or call `setState` on an attached one.
`state.view` is captured only for a virtualized, editor-owned element viewport;
the editor does not capture page or ancestor scrolling. Change and completion
events require document changes, so call `getState()` before teardown when a
selection-only or scroll-only session must be saved.

## `Editor` members

| Member                                                   | Purpose                                                   |
| -------------------------------------------------------- | --------------------------------------------------------- |
| `new Editor(kind, options?, editHistoryKey?)`            | Creates an editor and optionally opts into keyed history. |
| `Editor.disposeFile(editHistoryKey)`                     | Disposes one retained file draft and history.             |
| `Editor.disposeFileDiff(editHistoryKey)`                 | Disposes one retained diff draft and history.             |
| `Editor.clearDocuments()`                                | Disposes all retained drafts and histories.               |
| `Editor.setDocumentRegistryCapacity(capacity)`           | Sets the process-wide capacity for each surface kind.     |
| `edit(instance)`                                         | Attaches and returns the normal completion disposer.      |
| `setOptions(options)`                                    | Merges editor options.                                    |
| `applyEdits(edits, updateHistory?)`                      | Applies programmatic text edits.                          |
| `canUndo`                                                | Reports whether undo has an entry.                        |
| `canRedo`                                                | Reports whether redo has an entry.                        |
| `undo()`                                                 | Reverts the latest edit.                                  |
| `redo()`                                                 | Reapplies the latest reverted edit.                       |
| `getFile()`                                              | Gets the current file contents.                           |
| `getText()`                                              | Gets the current text.                                    |
| `getState()`                                             | Gets selections and editor-owned view state.              |
| `setState(state)`                                        | Sets selections and editor-owned view state.              |
| `setSelections(selections)`                              | Sets directed selection ranges.                           |
| `setMarkers(markers)`                                    | Sets diagnostic markers.                                  |
| `focus(options?)`                                        | Focuses the editor.                                       |
| `blur()`                                                 | Removes editor focus.                                     |
| `cleanUp(reason?: 'discard' \| 'recycle' \| 'complete')` | Detaches without running the completion callback.         |

`editHistoryKey` is an explicit opt-in key, not a file or diff `cacheKey` and
not derived from one. Editors of the same document kind can use it to resume a
retained draft and undo/redo history in memory. Retention uses independent,
least-recently-used file and file-diff registries with a default capacity of 100
each. A retained diff can resume only against the same old-side baseline, so
scope its key accordingly. Use the static disposal methods when a retained edit
is no longer needed.

Call the disposer returned by `edit(instance)` for the normal session-ending
path; it detaches and then runs the surface's completion boundary. `cleanUp()`
is the lower-level lifecycle primitive. Its reason controls document retention
and recycle ownership, but even `'complete'` does not invoke `onEditComplete` by
itself.

## `TextDocument` members

| Member                                               | Purpose                                               |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `new TextDocument(uri, text, languageId?, version?)` | Creates a text document.                              |
| `uri`                                                | Gets the document identifier.                         |
| `languageId`                                         | Gets the language identifier.                         |
| `version`                                            | Gets the document version.                            |
| `lineCount`                                          | Gets the line count.                                  |
| `eol`                                                | Gets the line-ending sequence.                        |
| `canUndo`                                            | Reports whether undo has an entry.                    |
| `canRedo`                                            | Reports whether redo has an entry.                    |
| `positionAt(offset)`                                 | Converts an offset to a position.                     |
| `positionsAt(offsets)`                               | Converts several offsets to positions.                |
| `offsetAt(position)`                                 | Converts a position to an offset.                     |
| `getText(range?)`                                    | Gets all text or one range.                           |
| `getLineText(line, includeLineBreak?)`               | Gets one line.                                        |
| `normalizeEol(text)`                                 | Converts text to the document line ending.            |
| `getLineLength(line, includeLineBreak?)`             | Gets one line length.                                 |
| `charAt(offsetOrPosition)`                           | Gets one character.                                   |
| `getTextSlice(start, end)`                           | Gets text between two offsets.                        |
| `findNextNonOverlappingSubstring(needle, occupied)`  | Finds an unused substring range.                      |
| `search(params)`                                     | Finds text ranges.                                    |
| `applyEdits(edits, ...)`                             | Resolves and applies position-based edits.            |
| `resolveEdits(edits)`                                | Converts position-based edits to offset edits.        |
| `applyResolvedEdits(edits, ...)`                     | Applies offset-based edits.                           |
| `setLastUndoSelectionsAfter(selections)`             | Associates selections with the latest history entry.  |
| `setLastUndoLineAnnotations(before, after)`          | Associates annotations with the latest history entry. |
| `undo()`                                             | Reverts one document history entry.                   |
| `redo()`                                             | Reapplies one document history entry.                 |
| `normalizePosition(position)`                        | Clamps a position to the document.                    |
