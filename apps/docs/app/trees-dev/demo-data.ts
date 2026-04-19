import type { FileTreeOptions } from '@pierre/trees';

export const sharedDemoPaths: readonly string[] = [
  'README.md',
  'package.json',
  'Build/index.mjs',
  'Build/scripts.js',
  'Build/assets/images/social/logo.png',
  'config/project/app.config.json',
  'node_modules/react/index.js',
  'node_modules/react/jsx-runtime.js',
  'node_modules/preact/index.js',
  'node_modules/preact/hooks.js',
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
  paths: sharedDemoPaths,
};

export const sharedInitialExpandedPaths: readonly string[] = [
  'Build/assets/images/social',
];
