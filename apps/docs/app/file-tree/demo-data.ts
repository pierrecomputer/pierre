import type { FileTreeOptions } from '@pierre/file-tree';

const sampleFileList: string[] = [
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
  'README.md',
  'package.json',
];

export const sharedDemoFileTreeOptions: FileTreeOptions = {
  config: {
    initialState: {
      expandedItems: ['src', 'src/utils'],
    },
  },
  flattenEmptyDirectories: true,
  files: sampleFileList,
};
