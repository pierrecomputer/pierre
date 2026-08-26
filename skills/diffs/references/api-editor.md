# Editor API

This reference lists the primary exports from `@pierre/diffs/edit` and the
editor APIs used by common integrations.

## Exports

| Export               | Kind  | Purpose                                                  |
| -------------------- | ----- | -------------------------------------------------------- |
| `Editor`             | Class | Adds text editing to a `File` or `FileDiff` instance.    |
| `EditorChange`       | Type  | Describes one normalized editor change.                  |
| `EditorChangeEvent`  | Type  | Provides normalized edits and the current document.      |
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
| `initialState`           | Transfers a complete edit session on first attach.       |
| `keymap`                 | Adds shortcut groups checked before the defaults.        |
| `roundedSelection`       | Controls rounded selection corners.                      |
| `matchBrackets`          | Controls matching-bracket highlights.                    |
| `autoSurround`           | Controls quote and bracket insertion around a selection. |
| `languageCommentConfig`  | Overrides comment tokens by language.                    |
| `enabledSelectionAction` | Enables the selection action surface.                    |
| `clipboard`              | Supplies a text clipboard reader.                        |
| `renderSelectionAction`  | Produces the selection action element.                   |
| `onAttach`               | Receives the editor and attached surface.                |
| `onChange`               | Receives the event, including its editor instance.       |
| `onFocus`                | Runs after the editor gains focus.                       |
| `onBlur`                 | Runs after the editor loses focus.                       |

Use `editHistoryKey` for ordinary in-memory restoration; it retains the draft,
undo/redo history, selections, and editor-owned view state without an
application synchronization loop. To move a complete session to another editor,
pass `getEditState()` directly as `initialState`. The editor adopts its
`TextDocument`, file metadata, history, editor state, and diff-session data by
reference. Do not retain, modify, clone, or serialize the value after passing it
to the editor. It is consumed after the first successful synchronization and is
not queued again by later option updates.

Use `getSurfaceState()` and `setSurfaceState()` for an isolated selection/view
copy or durable application persistence. `state.view` covers only a virtualized,
editor-owned element viewport, not page or ancestor scrolling.

`getEditState()` exposes the raw objects from the latest complete edit-lifecycle
checkpoint. Checkpoints run after synchronization, document edits, explicit
`setSurfaceState()` calls, recycling, and completion. Selection or scroll
movement alone does not update it; use `getSurfaceState()` for an exact live
copy. State remains available while rendering is recycled and during
`onEditComplete`, and returns `undefined` before synchronization or after
completion. The result is borrowed editor-owned state rather than a
serialization format.

## `Editor` members

| Member                                                   | Purpose                                                |
| -------------------------------------------------------- | ------------------------------------------------------ |
| `new Editor(kind, options?, editHistoryKey?)`            | Creates an editor with optional keyed state retention. |
| `Editor.disposeFile(editHistoryKey)`                     | Disposes one retained file editor state.               |
| `Editor.disposeFileDiff(editHistoryKey)`                 | Disposes one retained diff editor state.               |
| `Editor.clearDocuments()`                                | Disposes all retained editor states.                   |
| `Editor.setDocumentRegistryCapacity(capacity)`           | Sets the process-wide capacity for each surface kind.  |
| `edit(instance)`                                         | Attaches and returns the normal completion disposer.   |
| `setOptions(options)`                                    | Merges editor options.                                 |
| `applyEdits(edits, updateHistory?)`                      | Applies programmatic text edits.                       |
| `canUndo`                                                | Reports whether undo has an entry.                     |
| `canRedo`                                                | Reports whether redo has an entry.                     |
| `undo()`                                                 | Reverts the latest edit.                               |
| `redo()`                                                 | Reapplies the latest reverted edit.                    |
| `getFile()`                                              | Gets the current file contents.                        |
| `getText()`                                              | Gets the current text.                                 |
| `getSurfaceState()`                                      | Gets selections and editor-owned view state.           |
| `setSurfaceState(state)`                                 | Sets selections and editor-owned view state.           |
| `getEditState()`                                         | Gets the latest edit-lifecycle state checkpoint.       |
| `setSelections(selections)`                              | Sets directed selection ranges.                        |
| `setMarkers(markers)`                                    | Sets diagnostic markers.                               |
| `focus(options?)`                                        | Focuses the editor.                                    |
| `blur()`                                                 | Removes editor focus.                                  |
| `cleanUp(reason?: 'discard' \| 'recycle' \| 'complete')` | Suspends rendering or completes the editing session.   |

`editHistoryKey` is an explicit opt-in key, not a file or diff `cacheKey` and
not derived from one. Editors of the same document kind can use it to resume a
retained draft, undo/redo history, selections, and editor-owned view state in
memory. Retention uses independent, least-recently-used file and file-diff
registries with a default capacity of 100 each. A retained diff can resume only
against the same old-side baseline, so scope its key accordingly. Use the static
disposal methods when retained state is no longer needed.

Call the disposer returned by `edit(instance)` for the normal session-ending
path; it is equivalent to `cleanUp('complete')` and installs an accepted
completion result. `cleanUp('discard')` still publishes the completion event but
does not install its result. `cleanUp('recycle')` suspends rendering without
ending the session or changing the editor-component association. Calling
`edit(instance)` again resumes rendering for that same component.

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
