import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const VANILLA_QUICKSTART_INSTALL: PreloadFileOptions<undefined> = {
  file: {
    name: 'install.sh',
    contents: `bun add @pierre/trees
# npm: npm install @pierre/trees
# pnpm: pnpm add @pierre/trees`,
  },
  options,
};

export const VANILLA_QUICKSTART_MOUNT_PROJECT_TREE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'mount-project-tree.ts',
      contents: `import { FileTree, type FileTreePreparedInput } from '@pierre/trees';

export function mountProjectTree(
  container: HTMLElement,
  preparedInput: FileTreePreparedInput
) {
  const fileTree = new FileTree({
    preparedInput,
    search: true,
    initialExpandedPaths: ['src', 'src/components'],
    viewportHeight: 320,
  });

  fileTree.render({ fileTreeContainer: container });
  return fileTree;
}`,
    },
    options,
  };

export const VANILLA_QUICKSTART_IMPERATIVE_USAGE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'imperative-usage.ts',
      contents: `const fileTree = new FileTree({
  paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
  search: true,
});

fileTree.render({ fileTreeContainer: container });
fileTree.focusPath('src/index.ts');
fileTree.openSearch('button');

const selectedPaths = fileTree.getSelectedPaths();
const matchingPaths = fileTree.getSearchMatchingPaths();
const focusedPath = fileTree.getFocusedPath();
const buttonItem = fileTree.getItem('src/components/Button.tsx');
buttonItem?.select();`,
    },
    options,
  };
