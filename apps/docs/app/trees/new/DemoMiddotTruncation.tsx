import { preloadFileTree } from '@pierre/trees/ssr';

import { DemoMiddotTruncationClient } from './DemoMiddotTruncationClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const TRUNCATION_SEARCH_QUERY = 'truncation';

const TRUNCATION_DEMO_PATHS = [
  'README.md',
  'apps/docs/app/layout.tsx',
  'apps/docs/app/page.tsx',
  'apps/docs/app/examples/truncation/page.tsx',
  'apps/docs/app/examples/truncation/middle-truncation-playground.tsx',
  'apps/docs/app/examples/truncation/middle-truncation-playground.test.tsx',
  'apps/docs/app/examples/truncation/without-file-extension/README',
  'apps/docs/app/examples/truncation/without-file-extension/README.local',
  'apps/docs/app/trees/new/page.tsx',
  'apps/docs/components/ui/button.tsx',
  'apps/docs/components/ui/button-group.tsx',
  'apps/docs/components/ui/dropdown-menu.tsx',
  'apps/docs/components/examples/truncation/truncation-preview-card.tsx',
  'apps/docs/components/examples/truncation/truncation-preview-card.stories.tsx',
  'apps/docs/components/examples/truncation/use-middle-truncation-preview-state.ts',
  'apps/docs/lib/examples/truncation/build-middle-truncation-demo-state.ts',
  'apps/docs/lib/examples/truncation/build-middle-truncation-demo-state.test.ts',
  'packages/path-store/src/public-types.ts',
  'packages/path-store/src/visible-tree-projection.ts',
  'packages/trees/src/components/OverflowText.tsx',
  'packages/trees/src/react/useFileTree.ts',
  'packages/trees/src/react/useFileTreeSearch.ts',
  'packages/trees/src/render/FileTree.ts',
  'packages/trees/src/render/FileTreeView.tsx',
  'packages/trees/test/fixtures/docs/app-router/examples/truncation/middle-truncation-preview-panel.tsx',
  'packages/trees/test/fixtures/docs/app-router/examples/truncation/middle-truncation-preview-panel.test.tsx',
  'packages/trees/test/fixtures/docs/app-router/examples/truncation/without-file-extension/README',
  'packages/trees/test/fixtures/docs/app-router/examples/truncation/without-file-extension/README.local',
] as const;

const TRUNCATION_EXPANDED_PATHS = [
  'apps',
  'apps/docs',
  'apps/docs/app',
  'apps/docs/app/examples',
  'apps/docs/app/examples/truncation',
  'apps/docs/app/examples/truncation/without-file-extension',
  'apps/docs/components',
  'apps/docs/components/examples',
  'apps/docs/components/examples/truncation',
  'apps/docs/lib',
  'apps/docs/lib/examples',
  'apps/docs/lib/examples/truncation',
  'packages',
  'packages/trees',
  'packages/trees/test',
  'packages/trees/test/fixtures',
  'packages/trees/test/fixtures/docs',
  'packages/trees/test/fixtures/docs/app-router',
  'packages/trees/test/fixtures/docs/app-router/examples',
  'packages/trees/test/fixtures/docs/app-router/examples/truncation',
  'packages/trees/test/fixtures/docs/app-router/examples/truncation/without-file-extension',
  'packages/trees/src',
  'packages/trees/src/components',
  'packages/trees/src/react',
  'packages/trees/src/render',
] as const;

function createPreloadedData({
  flattenEmptyDirectories,
  id,
  search,
}: {
  flattenEmptyDirectories: boolean;
  id: string;
  search: boolean;
}) {
  return preloadFileTree({
    fileTreeSearchMode: search ? 'expand-matches' : undefined,
    flattenEmptyDirectories,
    id,
    initialExpandedPaths: TRUNCATION_EXPANDED_PATHS,
    initialSearchQuery: search ? TRUNCATION_SEARCH_QUERY : undefined,
    paths: TRUNCATION_DEMO_PATHS,
    search,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.middotTruncation,
  });
}

const hierarchicalPreloadedData = createPreloadedData({
  flattenEmptyDirectories: false,
  id: 'trees-middot-truncation-hierarchical',
  search: false,
});
const hierarchicalSearchPreloadedData = createPreloadedData({
  flattenEmptyDirectories: false,
  id: 'trees-middot-truncation-hierarchical-search',
  search: true,
});
const flattenedPreloadedData = createPreloadedData({
  flattenEmptyDirectories: true,
  id: 'trees-middot-truncation-flattened',
  search: false,
});
const flattenedSearchPreloadedData = createPreloadedData({
  flattenEmptyDirectories: true,
  id: 'trees-middot-truncation-flattened-search',
  search: true,
});

export function DemoMiddotTruncation() {
  return (
    <DemoMiddotTruncationClient
      preloadedDataById={{
        'trees-middot-truncation-flattened': flattenedPreloadedData,
        'trees-middot-truncation-flattened-search':
          flattenedSearchPreloadedData,
        'trees-middot-truncation-hierarchical': hierarchicalPreloadedData,
        'trees-middot-truncation-hierarchical-search':
          hierarchicalSearchPreloadedData,
      }}
      paths={TRUNCATION_DEMO_PATHS}
      searchQuery={TRUNCATION_SEARCH_QUERY}
    />
  );
}
