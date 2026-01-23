import { type FileTreeOptions, fileListToTree } from '@pierre/file-tree';

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

const expandedPaths = ['src', 'src/utils'];
const expandedItems = (() => {
  const tree = fileListToTree(sampleFileList);
  const idByPath = new Map(
    Object.entries(tree).map(([id, node]) => [node.path, id])
  );
  return expandedPaths.flatMap((path) => {
    const id = idByPath.get(path);
    return id != null ? [id] : [];
  });
})();

export const sharedDemoFileTreeOptions: FileTreeOptions = {
  config: {
    initialState: {
      expandedItems,
    },
    fileTreeSearchMode: 'collapse-non-matches',
  },
  flattenEmptyDirectories: true,
  files: sampleFileList,
};
