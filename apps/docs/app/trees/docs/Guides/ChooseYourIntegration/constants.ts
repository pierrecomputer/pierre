import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const CHOOSE_INTEGRATION_REACT_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'project-tree.tsx',
    contents: `import { FileTree, useFileTree } from '@pierre/trees/react';

export function ProjectTree({ paths }: { paths: readonly string[] }) {
  const { model } = useFileTree({ paths, search: true });

  return <FileTree model={model} className="h-96 rounded-lg border" />;
}`,
  },
  options,
};

export const CHOOSE_INTEGRATION_VANILLA_EXAMPLE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'mount-tree.ts',
      contents: `import { FileTree } from '@pierre/trees';

const fileTree = new FileTree({
  paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
  search: true,
});

const container = document.getElementById('project-tree');
if (container instanceof HTMLElement) {
  fileTree.render({ fileTreeContainer: container });
}`,
    },
    options,
  };
