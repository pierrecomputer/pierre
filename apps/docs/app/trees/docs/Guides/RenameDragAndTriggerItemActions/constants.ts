import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const RENAME_DRAG_RENAME: PreloadFileOptions<undefined> = {
  file: {
    name: 'rename.tsx',
    contents: `const { model } = useFileTree({
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

model.startRenaming('src/index.ts');`,
  },
  options,
};

export const RENAME_DRAG_DRAG_AND_DROP: PreloadFileOptions<undefined> = {
  file: {
    name: 'drag-and-drop.ts',
    contents: `const fileTree = new FileTree({
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
});`,
  },
  options,
};

export const RENAME_DRAG_CONTEXT_MENU: PreloadFileOptions<undefined> = {
  file: {
    name: 'context-menu.tsx',
    contents: `const { model } = useFileTree({
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
/>;`,
  },
  options,
};
