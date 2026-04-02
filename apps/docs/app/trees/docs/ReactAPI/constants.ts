import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const REACT_API_FILE_TREE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileExplorer.tsx',
    contents: `import { FileTree } from '@pierre/trees/react';

const files = [
  'src/index.ts',
  'src/components/Button.tsx',
  'src/utils/helpers.ts',
  'package.json',
];

export function FileExplorer() {
  return <FileTree options={{}} initialFiles={files} />;
}`,
  },
  options,
};

export const REACT_API_FILE_TREE_PROPS: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_tree_props.tsx',
    contents: `import { FileTree } from '@pierre/trees/react';

// FileTree accepts these props:

<FileTree
  // Required: options object + initialFiles (or controlled files)
  options={{
    flattenEmptyDirectories: true,
    fileTreeSearchMode: 'expand-matches',
    search: true,
    unsafeCSS: \`
      [data-item-section='icon'] {
        color: oklch(67% 0.2 25);
      }
    \`,
  }}
  initialFiles={['src/index.ts', 'package.json']}

  // Optional: uncontrolled state defaults
  initialExpandedItems={['src']}
  initialSelectedItems={['package.json']}
  initialSearchQuery="Button"

  // Optional: controlled state (overrides internal state each render)
  // files={controlledFiles}
  // expandedItems={controlledExpanded}
  // selectedItems={controlledSelected}

  // Optional: state change callbacks
  onSelection={(items) => console.log(items)}
  onExpandedItemsChange={(items) => console.log('expanded', items)}
  onSelectedItemsChange={(items) => console.log('selected', items)}
  onFilesChange={(files) => console.log('files', files)}

  // Optional: git status
  gitStatus={gitStatusEntries}

  // Optional: CSS class name and inline styles
  className="my-file-tree"
  style={{ maxHeight: 400 }}

  // Optional: pre-rendered HTML for SSR hydration
  prerenderedHTML={htmlFromServer}
/>`,
  },
  options,
};

export const REACT_API_CUSTOM_ICONS_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'custom_icons_file_tree.tsx',
    contents: `import { FileTree } from '@pierre/trees/react';

export function IconSetTree() {
  return (
    <FileTree
      options={{
        id: 'icon-set-tree',
        icons: {
          set: 'standard',
          colored: true,
        },
      }}
      initialFiles={[
        'src/index.ts',
        'src/components/Button.tsx',
        'package.json',
      ]}
      initialExpandedItems={['src', 'src/components']}
    />
  );
}`,
  },
  options,
};

export const REACT_API_GIT_STATUS_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'git_status_file_tree.tsx',
    contents: `import { useEffect, useState } from 'react';
import type { GitStatusEntry } from '@pierre/trees';
import { FileTree } from '@pierre/trees/react';

const files = [
  'README.md',
  'package.json',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/lib/utils.ts',
];

export function GitAwareTree() {
  const [gitStatus, setGitStatus] = useState<GitStatusEntry[] | undefined>();

  useEffect(() => {
    // Replace this with your VCS/remote status source.
    setGitStatus([
      { path: 'src/index.ts', status: 'modified' },
      { path: 'src/components/Button.tsx', status: 'added' },
      { path: 'README.md', status: 'deleted' },
    ]);
  }, []);

  return (
    <FileTree
      options={{ id: 'git-aware-tree' }}
      initialFiles={files}
      initialExpandedItems={['src', 'src/components']}
      gitStatus={gitStatus}
    />
  );
}`,
  },
  options,
};
