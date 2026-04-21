'use client';

import { IconCollapsedRow, IconEyeSlash, IconFolderOpen } from '@pierre/icons';
import type { FileTreeSearchMode } from '@pierre/trees';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import Link from 'next/link';
import { type CSSProperties, type ReactNode, useState } from 'react';

import { TreeExampleHeading } from '../components/TreeExampleHeading';
import { FeatureHeader } from '../diff-examples/FeatureHeader';
import { sampleFileList } from './demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { getDefaultFileTreePanelClass } from './tree-examples/demo-data';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
import { PRODUCTS } from '@/app/product-config';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

const PREPOPULATED_SEARCH = 'tsx';
// Pre-expand a couple of folders that contain no `.tsx` matches so the
// difference between `collapse-non-matches` (snaps them shut) and
// `expand-matches` (preserves prior expansion) is visible at a glance.
const PREPOPULATED_EXPANDED_PATHS = ['public/', 'node_modules/react/'];
const searchModeStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

interface SearchModeDemo {
  description: string;
  id: string;
  icon: ReactNode;
  mode: FileTreeSearchMode;
  shortLabel: string;
  title: string;
  viewportHeight: number;
}

const SEARCH_MODE_DEMOS: readonly SearchModeDemo[] = [
  {
    description: 'Hides files and folders without any matches',
    id: 'file-tree-search-demo-hide-non-matches',
    icon: <IconEyeSlash />,
    mode: 'hide-non-matches',
    shortLabel: 'Hide',
    title: 'hide-non-matches',
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.searchHideNonMatches,
  },
  {
    description: 'Collapses folders without any matches',
    id: 'file-tree-search-demo-collapse-non-matches',
    icon: <IconCollapsedRow />,
    mode: 'collapse-non-matches',
    shortLabel: 'Collapse',
    title: 'collapse-non-matches',
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.searchCollapseNonMatches,
  },
  {
    description: 'Keeps all items visible and expand folders with matches',
    id: 'file-tree-search-demo-expand-matches',
    icon: <IconFolderOpen />,
    mode: 'expand-matches',
    shortLabel: 'Expand',
    title: 'expand-matches',
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.searchExpandMatches,
  },
] as const;

function SearchModeTree({
  isMobileActive,
  modeDemo,
  preloadedData,
}: {
  isMobileActive: boolean;
  modeDemo: SearchModeDemo;
  preloadedData: FileTreePreloadedData;
}) {
  const { model } = useFileTree({
    fileTreeSearchMode: modeDemo.mode,
    flattenEmptyDirectories: true,
    id: modeDemo.id,
    initialExpandedPaths: PREPOPULATED_EXPANDED_PATHS,
    initialSearchQuery: PREPOPULATED_SEARCH,
    paths: sampleFileList,
    search: true,
    // Mirror the SSR preload so the filter survives React's per-tree mount
    // cascade (each tree's input briefly receives focus and then blurs as the
    // next sibling initializes). A real user blur-close still works once they
    // interact: the fake focus ring is dismissed on first pointer/focus/input.
    searchBlurBehavior: 'retain',
    searchFakeFocus: true,
    initialVisibleRowCount: modeDemo.viewportHeight / 30,
  });

  return (
    <div className={isMobileActive ? undefined : 'hidden sm:block'}>
      <TreeExampleHeading
        icon={modeDemo.icon}
        description={modeDemo.description}
      >
        <code>{modeDemo.title}</code>
      </TreeExampleHeading>
      <FileTree
        className={getDefaultFileTreePanelClass()}
        model={model}
        preloadedData={preloadedData}
        style={{
          ...searchModeStyle,
          height: `${String(modeDemo.viewportHeight)}px`,
        }}
      />
    </div>
  );
}

interface DemoSearchClientProps {
  preloadedDataById: Readonly<Record<string, FileTreePreloadedData>>;
}

export function DemoSearchClient({ preloadedDataById }: DemoSearchClientProps) {
  const [mobileView, setMobileView] = useState<string>(SEARCH_MODE_DEMOS[0].id);

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="search"
        title="Search and filter by name"
        description={
          <>
            Filter the tree by typing in the search field. Search across file
            paths and names. Trees includes three{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#shared-concepts-search-mode-semantics`}
              className="inline-link"
            >
              <code>fileTreeSearchMode</code>
            </Link>{' '}
            options to control how non-matching items are shown. All three demos
            below start with search prepopulated to show the different modes.
          </>
        }
      />
      <div className="space-y-4">
        <ButtonGroup
          className="sm:hidden"
          value={mobileView}
          onValueChange={setMobileView}
        >
          {SEARCH_MODE_DEMOS.map((modeDemo) => (
            <ButtonGroupItem
              key={modeDemo.id}
              value={modeDemo.id}
              aria-label={modeDemo.title}
              title={modeDemo.title}
            >
              {modeDemo.icon}
              {modeDemo.shortLabel}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SEARCH_MODE_DEMOS.map((modeDemo) => (
            <SearchModeTree
              key={modeDemo.id}
              isMobileActive={mobileView === modeDemo.id}
              modeDemo={modeDemo}
              preloadedData={preloadedDataById[modeDemo.id]}
            />
          ))}
        </div>
      </div>
    </TreeExampleSection>
  );
}
