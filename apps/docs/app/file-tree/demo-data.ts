import type { FileTreeOptions } from '@pierre/file-tree';

const sampleFileList: string[] = [
  'build/index.mjs',
  'build/scripts.js',
  'build/assets/images/social/logo.png',
  'config/project/app.config.json',
  'src/components/Button.tsx',
  'src/components/Card.tsx',
  'src/components/Header.tsx',
  'src/components/Sidebar.tsx',
  'src/lib/mdx.tsx',
  'src/lib/utils.ts',
  'src/utils/stream.ts',
  'src/utils/worker.ts',
  'src/index.ts',
  'README.md',
  'package.json',
];

export const sharedDemoFileTreeOptions: FileTreeOptions = {
  config: {
    initialState: {
      expandedItems: ['src'],
    },
  },
  collapseFolders: true,
  files: sampleFileList,
};
