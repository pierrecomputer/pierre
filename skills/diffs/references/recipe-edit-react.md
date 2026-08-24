# Recipe: edit with React

Mount one `EditProvider` above the editable surfaces. Its factory receives the
document kind, the surface's creation-time `editorOptions`, and an optional
`editHistoryKey`. Each active surface or `CodeView` item owns its editor.

Pass `editHistoryKey` to opt into bounded in-memory draft and undo/redo
retention across editor instances. Choose this key explicitly; it is not read
from or derived from a file or diff `cacheKey`. The same active key cannot be
shared by two editors of the same document kind.

Selection and view state remain application-owned. Capture `event.state` from
change or completion events and pass it back through
`editorOptions.initialState` when creating a later editor. `initialState` is
creation-time state consumed once on the first successful attach. Captured
scroll state exists only for virtualized editor-owned viewports, not page or
ancestor scrolling. Neither callback runs for a selection-only or scroll-only
session, so read `editor.getState()` before toggling edit off or unmounting when
those sessions must be saved.

## Contents

- [Edit a standalone file or diff](#edit-a-standalone-file-or-diff)
- [Keep annotations synchronized](#keep-annotations-synchronized)
- [Edit CodeView items](#edit-codeview-items)

## Edit a standalone file or diff

Set `edit` on `File`, `FileDiff`, `MultiFileDiff`, or `PatchDiff`. Pass editor
creation options through `editorOptions` and optional retention through
`editHistoryKey`.

```tsx
import type {
  FileContents,
  FileDiffEditCompleteEvent,
  FileDiffOptions,
} from '@pierre/diffs';
import {
  Editor,
  type EditorChangeEvent,
  type EditorDocumentKind,
  type EditorOptions,
  type EditorState,
} from '@pierre/diffs/edit';
import { EditProvider, MultiFileDiff, Virtualizer } from '@pierre/diffs/react';
import { useRef, useState } from 'react';

const oldFile: FileContents = {
  name: 'src/value.ts',
  contents: 'export const value = 1;',
};
const initialNewFile: FileContents = {
  name: 'src/value.ts',
  contents: 'export const value = 2;',
};
const diffOptions: FileDiffOptions<undefined> = {
  theme: { light: 'pierre-light', dark: 'pierre-dark' },
  diffStyle: 'split',
};

function createEditor<LAnnotation>(
  documentKind: EditorDocumentKind,
  options: EditorOptions<LAnnotation>,
  editHistoryKey?: string
) {
  return new Editor(documentKind, options, editHistoryKey);
}

export function EditableDiff() {
  const [edit, setEdit] = useState(false);
  const [newFile, setNewFile] = useState(initialNewFile);
  const draftRef = useRef(newFile);
  const savedStateRef = useRef<EditorState | undefined>(undefined);
  const editorRef = useRef<Editor<undefined> | null>(null);
  const editorOptions: EditorOptions<undefined> = {
    initialState: savedStateRef.current,
    onAttach(editor) {
      editorRef.current = editor;
    },
  };

  function toggleEdit() {
    if (edit && editorRef.current != null) {
      savedStateRef.current = editorRef.current.getState();
    }
    setEdit((value) => !value);
  }

  function handleEditChange(event: EditorChangeEvent<undefined, 'diff'>) {
    draftRef.current = event.file;
    savedStateRef.current = event.state;
    saveDraft(event.file);
  }

  function handleEditComplete(event: FileDiffEditCompleteEvent<undefined>) {
    savedStateRef.current = event.state;
    if (event.newFile != null) {
      draftRef.current = event.newFile;
      setNewFile(event.newFile);
    }
    return 'accept' as const;
  }

  return (
    <EditProvider createEditor={createEditor}>
      <button type="button" onClick={toggleEdit}>
        {edit ? 'Finish edit' : 'Edit'}
      </button>
      <button
        type="button"
        disabled={!edit}
        onClick={() => editorRef.current?.undo()}
      >
        Undo
      </button>
      <Virtualizer style={{ maxHeight: 480, overflow: 'auto' }}>
        <MultiFileDiff
          oldFile={oldFile}
          newFile={newFile}
          options={diffOptions}
          edit={edit}
          editorOptions={editorOptions}
          editHistoryKey="src/value.ts:draft"
          onEditChange={handleEditChange}
          onEditComplete={handleEditComplete}
        />
      </Virtualizer>
    </EditProvider>
  );
}
```

Mount the provider near the application root when many surfaces use edit mode.
Always forward all three factory arguments. Use `onAttach` when controls need
`undo`, `redo`, `applyEdits`, selections, markers, focus, or other editor APIs.
Call `Editor.disposeFile(key)`, `Editor.disposeFileDiff(key)`, or
`Editor.clearDocuments()` when retained drafts should be discarded. The
registries keep 100 dormant entries per surface kind by default; change both
capacities with `Editor.setDocumentRegistryCapacity(capacity)`.

## Keep annotations synchronized

Edit mode owns annotation positions during an active session. Change events
expose the remapped collection for observation, but do not feed it back into the
surface. On acceptance, store the completion event's final annotations beside
the accepted file or diff. Use `isFileAnnotationCollection` or
`isDiffAnnotationCollection` when the surface type is not already known, and key
annotation UI state by a stable metadata ID instead of a line number.

## Edit `CodeView` items

Wrap `CodeView` in the same `EditProvider`. Set `edit: true` on an item and
increment its `version`. Pass shared creation options through the `CodeView`
`editorOptions` prop. Use `getEditHistoryKey(item)` for opt-in draft and history
retention; it is not inferred from the item's file or diff `cacheKey`.

Use `onItemEditChange` for live contents and annotation changes. Use
`onItemEditComplete` to accept or reject the completed edit. If you use keyed
render caching, assign a fresh `cacheKey` to the event's file or diff. Put the
supplied `nextItem` into controlled state only while the item should remain,
then return `'accept'`; acceptance during removal or teardown does not reinsert
it. `CodeView` builds `nextItem` with `edit: false` and an incremented
`version`; the render `cacheKey` remains separate from `editHistoryKey`.

`CodeViewHandle.getEditor(id)` returns the public `DiffsEditor` lifecycle type.
Retain or narrow the concrete `Editor` created by the provider factory for fully
typed imperative commands. The item editor keeps its active document and history
when virtualization or collapse removes the item from the rendered window.
`getEditHistoryKey` extends that retention to later editor instances after the
edit session ends.

When a worker pool highlights an editable surface, set
`useTokenTransformer: true` in the worker `highlighterOptions`.
