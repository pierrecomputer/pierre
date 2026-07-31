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
  isDiffAnnotationCollection,
  type DiffLineAnnotation,
  type FileContents,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';

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

const view = new FileDiff<ThreadMetadata>({
  theme: { light: 'pierre-light', dark: 'pierre-dark' },
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

const editor = new Editor<ThreadMetadata>({
  onChange(file, nextAnnotations) {
    newFile = { ...newFile, contents: file.contents };
    saveDraft(newFile);

    if (
      nextAnnotations != null &&
      isDiffAnnotationCollection(nextAnnotations) &&
      nextAnnotations !== annotations
    ) {
      annotations = nextAnnotations;
      queueMicrotask(render);
    }
  },
});

const detach = editor.edit(view);

export function stopEditing() {
  detach();
}

export function removeSurface() {
  editor.cleanUp();
  view.cleanUp();
}
```

The annotation array from `onChange` is the complete current collection. Save it
before a later render can apply old coordinates. Use stable metadata IDs for
application state that belongs to an annotation.

Use `VirtualizedFile` or `VirtualizedFileDiff` with a `Virtualizer` for a large
standalone surface. Load `@pierre/diffs/editor` with `import()` when edit mode
is optional and the initial bundle must omit the editor.

## Edit `CodeView` items

Pass a factory through `CodeViewOptions.createEditor`:

```ts
import { CodeView } from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';

export function mountEditableCodeView(root: HTMLElement) {
  const viewer = new CodeView({
    createEditor(options) {
      return new Editor(options);
    },
    onItemEditChange(item, file, nextAnnotations) {
      saveItemDraft(item.id, file, nextAnnotations);
    },
    onItemEditComplete(item, file) {
      const current = viewer.getItem(item.id);
      if (current?.type !== 'file') return;

      const version = (current.version ?? 0) + 1;
      viewer.updateItem({
        ...current,
        edit: false,
        version,
        file: {
          ...file,
          cacheKey: current.id + ':v' + version,
        },
      });
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

Set `edit: true` on an item and increment its `version`. In
`onItemEditComplete`, write the final contents into that item, set
`edit: false`, assign a fresh `cacheKey`, and increment `version` again.
`CodeView` creates and removes the item editors.

Call `viewer.getEditor(id)` for `undo`, `redo`, `applyEdits`, selections,
markers, focus, or other editor commands. Call `viewer.cleanUp()` when the host
removes the viewer.

When a worker pool highlights an editable surface, set
`useTokenTransformer: true` in the worker `highlighterOptions`.
