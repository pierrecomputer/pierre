import type { FileTreeOptions } from '@pierre/file-tree';
import { fileListToTree } from '@pierre/file-tree';

export const syncDemoDataLoader = {
  getItem: (id: string) => generatedSampleTree[id],
  getChildren: (id: string) => generatedSampleTree[id]?.children ?? [],
};

export const sharedDemoFileTreeOptions: FileTreeOptions = {
  config: {
    initialState: {
      expandedItems: ['src', 'src/components'],
    },
    rootItemId: 'root',
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => {
      const children = item.getItemData()?.children;
      return children != null;
    },
    dataLoader: syncDemoDataLoader,
  },
};

const sampleFileList: string[] = [
  'build/index.mjs',
  'build/scripts.js',
  'config/app.config.json',
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

const generatedSampleTree = fileListToTree(sampleFileList);
console.log('generatedSampleTree', generatedSampleTree);
