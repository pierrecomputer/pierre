# Recipe: edit with vanilla JavaScript

Render a standalone surface first. Then attach one `Editor` to it. Use one
editor for each surface that can be edited at the same time.

## Contents

- [Edit a standalone diff](#edit-a-standalone-diff)
- [Edit CodeView items](#edit-codeview-items)

## Edit a standalone diff

```ts
import {
  FileDiff,
  type DiffLineAnnotation,
  type FileContents,
} from '@pierre/diffs';
import { Editor, type EditorState } from '@pierre/diffs/edit';

interface ThreadMetadata {
  id: string;
}

const hostElement = document.querySelector<HTMLElement>('#diff');
if (hostElement == null) throw new Error('Missing diff host');
const host: HTMLElement = hostElement;

const oldFile: FileContents = {
  name: 'src/value.ts',
  contents: 'export const value = 1;',
};
let newFile: FileContents = {
  name: 'src/value.ts',
  contents: 'export const value = 2;',
};
let annotations: DiffLineAnnotation<ThreadMetadata>[] = [
  {
    side: 'additions',
    lineNumber: 1,
    metadata: { id: 'value-review' },
  },
];
let editorState: EditorState | undefined;

const view = new FileDiff<ThreadMetadata>({
  theme: { light: 'pierre-light', dark: 'pierre-dark' },
  onEditChange(event) {
    editorState = event.state;
    saveDraft(event.file);
  },
  onEditComplete(event) {
    editorState = event.state;
    if (event.newFile != null) {
      newFile = event.newFile;
    }
    if (event.lineAnnotations != null) {
      annotations = event.lineAnnotations;
    }
    return 'accept';
  },
  renderAnnotation(annotation) {
    const element = document.createElement('p');
    element.textContent = 'Thread ' + annotation.metadata.id;
    return element;
  },
});

function render() {
  view.render({
    fileContainer: host,
    oldFile,
    newFile,
    lineAnnotations: annotations,
  });
}

render();

const editor = new Editor<ThreadMetadata>('file-diff', {
  initialState: editorState,
});

const detach = editor.edit(view);
let editorAttached = true;

function detachEditor() {
  if (!editorAttached) return;
  // Change/completion events do not fire for selection-only sessions.
  editorState = editor.getState();
  editorAttached = false;
  detach();
}

export function stopEditing() {
  detachEditor();
}

export function removeSurface() {
  detachEditor();
  view.cleanUp();
}
```

`onEditChange` receives one `EditorChangeEvent`. Observe its remapped
`lineAnnotations`, but do not feed them back into the surface during the active
session. Store the final collection from `onEditComplete` alongside the accepted
file or diff. Event `state` contains the current selections and editor-owned
viewport state; pass captured state as `initialState` when creating a later
editor. Read `editor.getState()` before teardown when selection-only or
scroll-only sessions must also be saved. Use stable metadata IDs for application
state that belongs to an annotation.

Pass a third `editHistoryKey` argument to `new Editor` only when a later editor
instance should resume the in-memory draft and undo/redo history. It is an
explicit retention key, not a file or diff render `cacheKey` and is not derived
from one.

Use `VirtualizedFile` or `VirtualizedFileDiff` with a `Virtualizer` for a large
standalone surface. Load `@pierre/diffs/edit` with `import()` when edit mode is
optional and the initial bundle must omit the editor.

## Edit `CodeView` items

Pass a factory through `CodeViewOptions.createEditor`:

```ts
import { CodeView } from '@pierre/diffs';
import { Editor } from '@pierre/diffs/edit';

export function mountEditableCodeView(root: HTMLElement) {
  const viewer = new CodeView({
    getEditHistoryKey(item) {
      return 'draft:' + item.id;
    },
    createEditor(documentKind, options, editHistoryKey) {
      return new Editor(documentKind, options, editHistoryKey);
    },
    onItemEditChange(event, item) {
      saveItemDraft(item.id, event.file, event.lineAnnotations, event.state);
    },
    onItemEditComplete(event, item, nextItem) {
      saveItemEditorState(item.id, event.state);
      if (item.type !== 'file' || !('file' in event)) return 'reject';

      // Re-key only if this item participates in keyed render caching.
      event.file.cacheKey = item.id + ':v' + nextItem.version;
      return 'accept';
    },
  });

  viewer.setup(root);
  viewer.setItems([
    {
      id: 'file:src/value.ts',
      type: 'file',
      file: {
        name: 'src/value.ts',
        contents: 'export const value = 1;',
      },
      edit: true,
      version: 0,
    },
  ]);

  return viewer;
}
```

Set `edit: true` on an item and increment its `version`. `onItemEditChange`
receives `(event, item)`; use `event.file`, `event.lineAnnotations`, and
`event.state` without feeding the change back into the viewer. Completion
receives `(event, item, nextItem)`. `CodeView` builds `nextItem` with the final
contents and annotations, `edit: false`, and an incremented `version`. If you
use keyed render caching, assign a fresh `cacheKey` to `event.file` or
`event.fileDiff`. Return `'accept'` to install `nextItem` while the item remains
present or `'reject'` to restore the original item while it remains present.
During removal or viewer teardown, neither decision reinserts the item. A
missing completion callback rejects. A controlled React owner should put
`nextItem` into its `items` state only when the item should remain.

`getEditHistoryKey(item)` opts an item into draft and undo/redo retention across
editor instances. Forward the resulting third factory argument to `new Editor`.
The edit history key is separate from the file or diff `cacheKey`, which remains
a render-cache invalidation hint. `CodeView` creates and removes the item
editors.

`viewer.getEditor(id)` returns the public `DiffsEditor` lifecycle type. Retain
or narrow the concrete `Editor` created by your factory for fully typed commands
such as `undo`, `applyEdits`, markers, or focus. Call `viewer.cleanUp()` when
the host removes the viewer.

When a worker pool highlights an editable surface, set
`useTokenTransformer: true` in the worker `highlighterOptions`.
