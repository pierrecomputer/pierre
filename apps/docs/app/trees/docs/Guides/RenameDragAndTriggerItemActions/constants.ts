import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const RENAME_DRAG_RENAME = docsCodeSnippet(
  'rename.tsx',
  `const { model } = useFileTree({
  paths,
  renaming: {
    canRename: (item) => item.path !== 'package.json',
    onRename: ({ sourcePath, destinationPath }) => {
      console.log(\`Renamed \${sourcePath} -> \${destinationPath}\`);
    },
    onError: (message) => {
      console.error(message);
    },
  },
});

model.startRenaming('src/index.ts');`
);

export const RENAME_DRAG_DRAG_AND_DROP = docsCodeSnippet(
  'drag-and-drop.ts',
  `const fileTree = new FileTree({
  paths,
  dragAndDrop: {
    canDrag: (draggedPaths) => draggedPaths.includes('package.json') === false,
    canDrop: ({ target }) => target.directoryPath !== 'dist/',
    onDropComplete: ({ draggedPaths, target }) => {
      console.log(
        'Moved',
        draggedPaths,
        'to',
        target.directoryPath ?? '(root)'
      );
    },
    onDropError: (message) => {
      console.error(message);
    },
  },
});`
);

export const RENAME_DRAG_CONTEXT_MENU = docsCodeSnippet(
  'context-menu.tsx',
  `const { model } = useFileTree({
  paths,
  composition: {
    contextMenu: {
      enabled: true,
      triggerMode: 'both',
      buttonVisibility: 'when-needed',
    },
  },
  renaming: true,
});

<FileTree
  model={model}
  renderContextMenu={(item, context) => (
    <div className="rounded-md border bg-background p-2 shadow">
      <button
        onClick={() => {
          context.close({ restoreFocus: false });
          model.startRenaming(item.path);
        }}
        type="button"
      >
        Rename
      </button>
    </div>
  )}
/>;`
);
