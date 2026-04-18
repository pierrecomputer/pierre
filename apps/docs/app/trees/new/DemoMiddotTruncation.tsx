import { preloadPathStoreFileTree } from '@pierre/trees/path-store';

import { DemoMiddotTruncationClient } from './DemoMiddotTruncationClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const TRUNCATION_DEMO_PATHS = [
  'apps/marketing/src/components/hero/super-long-component-name-without-extension/README',
  'apps/marketing/src/components/hero/super-long-component-name-without-extension/README.local',
  'packages/trees/src/path-store/view/format-flattened-segments-and-preserve-extension-state.machine.tsx',
  'packages/trees/src/path-store/view/format-flattened-segments-and-preserve-extension-state.machine.test.tsx',
  'src/flattened/a/b/c/d/e/f/g/h/this-is-a-very-long-leaf-name-for-a-flattened-directory-segment.ts',
  'src/flattened/a/b/c/d/e/f/g/h/this-is-another-very-long-leaf-name-for-a-flattened-directory-segment.ts',
  'src/without-extension/a-path-that-ends-in-a-readme-file/README',
] as const;

const TRUNCATION_EXPANDED_PATHS = ['apps', 'packages', 'src'] as const;

function createPreloadedData(id: string, flattenEmptyDirectories: boolean) {
  return preloadPathStoreFileTree({
    flattenEmptyDirectories,
    id,
    initialExpandedPaths: TRUNCATION_EXPANDED_PATHS,
    paths: TRUNCATION_DEMO_PATHS,
    search: false,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.middotTruncation,
  });
}

const hierarchicalPreloadedData = createPreloadedData(
  'path-store-middot-truncation-hierarchical',
  false
);
const flattenedPreloadedData = createPreloadedData(
  'path-store-middot-truncation-flattened',
  true
);

export function DemoMiddotTruncation() {
  return (
    <DemoMiddotTruncationClient
      preloadedData={{
        flattened: flattenedPreloadedData,
        hierarchical: hierarchicalPreloadedData,
      }}
      paths={TRUNCATION_DEMO_PATHS}
    />
  );
}
