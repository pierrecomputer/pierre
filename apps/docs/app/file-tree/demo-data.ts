import type { FileTreeOptions } from '@pierre/file-tree';

const sampleFileList: string[] = [
  'README.md',
  'package.json',
  'Build/index.mjs',
  'Build/scripts.js',
  'Build/assets/images/social/logo.png',
  'config/project/app.config.json',
  'src/components/Button.tsx',
  'src/components/Card.tsx',
  'src/components/Header.tsx',
  'src/components/Sidebar.tsx',
  'src/lib/mdx.tsx',
  'src/lib/utils.ts',
  'src/utils/stream.ts',
  'src/utils/worker.ts',
  'src/utils/worker/index.ts',
  'src/utils/worker/deprecrated/old-worker.ts',
  'src/index.ts',
  '.gitignore',
];

export const sharedDemoFileTreeOptions: FileTreeOptions = {
  config: {
    initialState: {
      // TODO: We should be able to specify file paths directly
      // (e.g., 'Build/assets/images/social') and have the library
      // automatically compute the required expandedItems. Currently users must:
      // 1. Know about the internal 'f::' prefix for flattened folder IDs
      // 2. Specify all intermediate folder paths when not flattened
      // This leaks internal implementation details.
      expandedItems: [
        'Build',
        // Flattened ID (uses 'f::' prefix)
        'f::Build/assets/images/social',
        // Non-flattened IDs (all intermediate folders)
        'Build/assets',
        'Build/assets/images',
        'Build/assets/images/social',
      ],
    },
    fileTreeSearchMode: 'collapse-non-matches',
  },
  onSelection: (selection) => {
    console.log('selection', selection);
  },
  flattenEmptyDirectories: true,
  files: sampleFileList,
};
