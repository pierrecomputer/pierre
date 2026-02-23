import type { PreloadFileOptions } from '@pierre/diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
} as const;

export const FILES_OPTION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'fileTreeOptions.ts',
    contents: `const fileTreeOptions = {
  initialFiles: [
    'README.md',
    'package.json',
    'src/index.ts',
    'src/components/Button.tsx',
    'src/utils/helpers.ts',
  ],
  // …
};`,
  },
  options,
};

export const ON_SELECTION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'onSelection.ts',
    contents: `// React: top-level prop
<FileTree
  options={{ initialFiles: ['src/index.ts', 'src/components/Button.tsx'] }}
  onSelection={(items: FileTreeSelectionItem[]) => {
    const file = items.find((i) => !i.isFolder);
    if (file) setSelectedPath(file.path);
  }}
/>;

// Vanilla: FileTreeStateConfig (second constructor argument)
const stateConfig = {
  onSelection: (items: FileTreeSelectionItem[]) => {
  const file = items.find((i) => !i.isFolder);
  if (file) setSelectedPath(file.path);
  },
};`,
  },
  options,
};
