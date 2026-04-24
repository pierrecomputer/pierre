export const REVEAL_DEMO_ROOT_PATHS: readonly string[] = [
  'apps/',
  'docs/',
  'packages/',
  'scripts/',
  'tests/',
];

export const REVEAL_DEMO_SNAPSHOTS = {
  'apps/': {
    childDirectoryKnownChildCounts: [2, 3],
    children: ['apps/demo/', 'apps/docs/'],
  },
  'apps/demo/': {
    children: ['apps/demo/app.tsx', 'apps/demo/index.html'],
  },
  'apps/docs/': {
    childDirectoryKnownChildCounts: [2, undefined, undefined],
    children: [
      'apps/docs/app/',
      'apps/docs/package.json',
      'apps/docs/tsconfig.json',
    ],
  },
  'apps/docs/app/': {
    children: ['apps/docs/app/layout.tsx', 'apps/docs/app/page.tsx'],
  },
  'docs/': {
    childDirectoryKnownChildCounts: [2, undefined],
    children: ['docs/architecture/', 'docs/changelog.md'],
  },
  'docs/architecture/': {
    children: [
      'docs/architecture/loading.md',
      'docs/architecture/virtualization.md',
    ],
  },
  'packages/': {
    childDirectoryKnownChildCounts: [2, 2, 2],
    children: [
      'packages/path-store/',
      'packages/tree-test-data/',
      'packages/trees/',
    ],
  },
  'packages/path-store/': {
    children: ['packages/path-store/package.json', 'packages/path-store/src/'],
  },
  'packages/path-store/src/': {
    children: [
      'packages/path-store/src/index.ts',
      'packages/path-store/src/store.ts',
    ],
  },
  'packages/tree-test-data/': {
    children: [
      'packages/tree-test-data/package.json',
      'packages/tree-test-data/src/',
    ],
  },
  'packages/tree-test-data/src/': {
    children: [
      'packages/tree-test-data/src/index.ts',
      'packages/tree-test-data/src/workloads.ts',
    ],
  },
  'packages/trees/': {
    childDirectoryKnownChildCounts: [undefined, 2, 2],
    children: [
      'packages/trees/package.json',
      'packages/trees/src/',
      'packages/trees/test/',
    ],
  },
  'packages/trees/src/': {
    children: ['packages/trees/src/index.ts', 'packages/trees/src/FileTree.ts'],
  },
  'packages/trees/test/': {
    children: [
      'packages/trees/test/file-tree.test.ts',
      'packages/trees/test/reveal-loading.test.ts',
    ],
  },
  'scripts/': {
    children: ['scripts/build-icons.ts', 'scripts/release.ts'],
  },
  'tests/': {
    childDirectoryKnownChildCounts: [2, undefined],
    children: ['tests/e2e/', 'tests/readme.md'],
  },
  'tests/e2e/': {
    children: ['tests/e2e/reveal.spec.ts', 'tests/e2e/bulk.spec.ts'],
  },
} as const;

export const REVEAL_DEMO_BATCH_FAILURE_PATH = 'packages/path-store/';
