export const DEBUG_REVEAL_ROOT_PATHS: readonly string[] = [
  'apps/',
  'packages/',
];

export const DEBUG_REVEAL_SNAPSHOTS = {
  'apps/': {
    children: ['apps/demo/', 'apps/docs/'],
    childDirectoryKnownChildCounts: [2, 2],
  },
  'apps/demo/': {
    children: ['apps/demo/index.ts', 'apps/demo/view.tsx'],
  },
  'apps/docs/': {
    children: ['apps/docs/page.tsx', 'apps/docs/layout.tsx'],
  },
  'packages/': {
    children: ['packages/path-store/', 'packages/trees/'],
    childDirectoryKnownChildCounts: [2, 2],
  },
  'packages/path-store/': {
    children: ['packages/path-store/index.ts', 'packages/path-store/store.ts'],
  },
  'packages/trees/': {
    children: ['packages/trees/index.ts', 'packages/trees/FileTree.ts'],
  },
} as const;
