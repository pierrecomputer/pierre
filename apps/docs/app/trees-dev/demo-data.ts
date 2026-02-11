import type {
  FileTreeOptions,
  FileTreeSelectionItem,
  FileTreeStateConfig,
} from '@pierre/trees';

export const sampleFileList: string[] = [
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
  flattenEmptyDirectories: true,
  files: sampleFileList,
  config: {
    fileTreeSearchMode: 'collapse-non-matches',
  },
};

export const sharedDemoStateConfig: FileTreeStateConfig = {
  defaultExpandedItems: ['Build/assets/images/social'],
  onSelection: (selection: FileTreeSelectionItem[]) => {
    console.log('selection', selection);
  },
};
