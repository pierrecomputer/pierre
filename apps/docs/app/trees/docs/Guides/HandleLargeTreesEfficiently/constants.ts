import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const LARGE_TREES_LOAD_WORKSPACE_TREE: PreloadFileOptions<undefined> = {
  file: {
    name: 'load-workspace-tree.ts',
    contents: `import { preparePresortedFileTreeInput } from '@pierre/trees';

export async function loadWorkspaceTree() {
  const sortedPaths = await fetchSortedWorkspacePaths();
  return preparePresortedFileTreeInput(sortedPaths);
}`,
  },
  options,
};

export const LARGE_TREES_VIRTUALIZATION_KNOBS: PreloadFileOptions<undefined> = {
  file: {
    name: 'virtualization-knobs.tsx',
    contents: `const { model } = useFileTree({
  preparedInput,
  viewportHeight: 420,
  itemHeight: 30,
  overscan: 8,
});`,
  },
  options,
};
