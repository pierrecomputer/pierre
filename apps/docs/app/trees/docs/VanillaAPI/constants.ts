import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const VANILLA_API_FILE_TREE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_tree_example.ts',
    contents: `import { FileTree } from '@pierre/trees';

const files = [
  'src/index.ts',
  'src/components/Button.tsx',
  'src/utils/helpers.ts',
  'package.json',
];

const fileTree = new FileTree({ initialFiles: files });
fileTree.render({ containerWrapper: document.getElementById('tree-container') });

// Clean up when done
// fileTree.cleanUp();`,
  },
  options,
};

export const VANILLA_API_FILE_TREE_OPTIONS: PreloadFileOptions<undefined> = {
  file: {
    name: 'file_tree_options.ts',
    contents: `import { FileTree } from '@pierre/trees';
import type { FileTreeStateConfig } from '@pierre/trees';

// Constructor options (see FileTree options section for full details)
const options = {
  initialFiles: ['src/index.ts', 'package.json'],
  id: 'my-tree',
  flattenEmptyDirectories: true,
  fileTreeSearchMode: 'expand-matches',
  search: true,
  unsafeCSS: \`
    button[data-type='item'][data-item-selected] {
      border-radius: 999px;
    }
  \`,
  useLazyDataLoader: false,
};

const stateConfig: FileTreeStateConfig = {
  initialExpandedItems: ['src'],
  initialSelectedItems: ['package.json'],
  onSelection: (items) => console.log(items),
};

const fileTree = new FileTree(options, stateConfig);

// Render into the DOM
fileTree.render({
  fileTreeContainer: existingElement,  // optional: reuse a <file-tree-container> element
  containerWrapper: document.body,     // optional: append to this parent
});

// Instance methods
fileTree.getFileTreeContainer();  // get the root <file-tree-container> element
fileTree.setOptions({ fileTreeSearchMode: 'hide-non-matches' });

// Imperative state
fileTree.setExpandedItems(['src', 'src/components']);
fileTree.expandItem('src');
fileTree.collapseItem('src/components');
fileTree.setFiles(['src/index.ts', 'src/new-file.ts', 'package.json']);
console.log(fileTree.getFiles(), fileTree.getExpandedItems());

fileTree.cleanUp();               // unmount and clear references`,
  },
  options,
};

export const VANILLA_API_GIT_STATUS_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'git_status_file_tree.ts',
    contents: `import type { GitStatusEntry } from '@pierre/trees';
import { FileTree } from '@pierre/trees';

const files = [
  'README.md',
  'package.json',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/lib/utils.ts',
];

const initialGitStatus: GitStatusEntry[] = [
  { path: 'src/index.ts', status: 'modified' },
  { path: 'src/components/Button.tsx', status: 'added' },
];

const fileTree = new FileTree({
  initialFiles: files,
  id: 'git-aware-tree-vanilla',
  gitStatus: initialGitStatus,
});

fileTree.render({
  containerWrapper: document.getElementById('tree-container') ?? undefined,
});

async function refreshGitStatus() {
  // Replace this with your VCS/remote status source.
  const nextStatus: GitStatusEntry[] = [
    { path: 'src/lib/utils.ts', status: 'modified' },
    { path: 'README.md', status: 'deleted' },
  ];

  fileTree.setGitStatus(nextStatus);
  console.log(fileTree.getGitStatus());
}

void refreshGitStatus();`,
  },
  options,
};

export const VANILLA_API_CUSTOM_ICONS_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'custom_icons_file_tree.ts',
    contents: `import { FileTree } from '@pierre/trees';

const customSpriteSheet = \`
  <svg data-icon-sprite aria-hidden="true" width="0" height="0">
    <symbol id="my-file" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
      <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
    </symbol>
  </svg>
\`;

const fileTree = new FileTree({
  initialFiles: [
    'src/index.ts',
    'src/components/Button.tsx',
    'package.json',
  ],
  icons: {
    spriteSheet: customSpriteSheet,
    remap: {
      'file-tree-icon-file': 'my-file',
    },
  },
});

fileTree.render({
  containerWrapper: document.getElementById('tree-container') ?? undefined,
});`,
  },
  options,
};
