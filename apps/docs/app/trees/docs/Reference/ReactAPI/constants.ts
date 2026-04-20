import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const REACT_API_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'project-tree.tsx',
    contents: `import { FileTree, useFileTree } from '@pierre/trees/react';

export function ProjectTree({ paths }: { paths: readonly string[] }) {
  const { model } = useFileTree({ paths, search: true });
  return <FileTree model={model} />;
}`,
  },
  options,
};

export const REACT_API_SELECTOR_HOOKS: PreloadFileOptions<undefined> = {
  file: {
    name: 'selector-hooks.tsx',
    contents: `const { model } = useFileTree({ paths, search: true });
const selectedPaths = useFileTreeSelection(model);
const search = useFileTreeSearch(model);
const focusedPath = useFileTreeSelector(model, (currentModel) =>
  currentModel.getFocusedPath()
);`,
  },
  options,
};
