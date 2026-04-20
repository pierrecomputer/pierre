import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const SSR_GUIDE_PRELOAD_FILE_TREE: PreloadFileOptions<undefined> = {
  file: {
    name: 'preload-file-tree.ts',
    contents: `import { preloadFileTree } from '@pierre/trees/ssr';

const payload = preloadFileTree({
  preparedInput,
  id: 'project-tree',
  initialExpandedPaths: ['src'],
  search: true,
  viewportHeight: 320,
});`,
  },
  options,
};

export const SSR_GUIDE_REACT_HYDRATION: PreloadFileOptions<undefined> = {
  file: {
    name: 'project-tree-client.tsx',
    contents: `import { FileTree, useFileTree } from '@pierre/trees/react';
import type { FileTreePreparedInput } from '@pierre/trees';
import type { FileTreeSsrPayload } from '@pierre/trees/ssr';

export function ProjectTreeClient({
  preparedInput,
  preloadedData,
}: {
  preparedInput: FileTreePreparedInput;
  preloadedData: FileTreeSsrPayload;
}) {
  const { model } = useFileTree({
    preparedInput,
    id: preloadedData.id,
    initialExpandedPaths: ['src'],
    search: true,
    viewportHeight: 320,
  });

  return <FileTree model={model} preloadedData={preloadedData} />;
}`,
  },
  options,
};

export const SSR_GUIDE_VANILLA_HYDRATION: PreloadFileOptions<undefined> = {
  file: {
    name: 'vanilla-hydrate.ts',
    contents: `import { FileTree } from '@pierre/trees';

const fileTree = new FileTree({
  preparedInput,
  id: 'project-tree',
  initialExpandedPaths: ['src'],
  search: true,
  viewportHeight: 320,
});

const container = document.getElementById('project-tree');
if (container instanceof HTMLElement) {
  fileTree.hydrate({ fileTreeContainer: container });
}`,
  },
  options,
};
