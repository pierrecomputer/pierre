'use client';

import { IconCollapsedRow, IconEyeSlash, IconFolderOpen } from '@pierre/icons';
import type { FileTreeSearchMode } from '@pierre/trees';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect } from 'react';

import { TreeExampleHeading } from '../../components/TreeExampleHeading';
import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { sampleFileList } from '../demo-data';
import { DEFAULT_FILE_TREE_PANEL_CLASS } from '../tree-examples/demo-data';
import { TreeExampleSection } from '../tree-examples/TreeExampleSection';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { PRODUCTS } from '@/app/product-config';

const PREPOPULATED_SEARCH = 'tsx';
const PRESELECTED_FILE = 'src/components/Button.tsx';
const searchModeStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

interface SearchModeDemo {
  description: string;
  id: string;
  icon: ReactNode;
  mode: FileTreeSearchMode;
  title: string;
  viewportHeight: number;
}

const SEARCH_MODE_DEMOS: readonly SearchModeDemo[] = [
  {
    description: 'Hides files and folders without any matches',
    id: 'file-tree-search-demo-hide-non-matches',
    icon: <IconEyeSlash />,
    mode: 'hide-non-matches',
    title: 'hide-non-matches',
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.searchHideNonMatches,
  },
  {
    description: 'Collapses folders without any matches',
    id: 'file-tree-search-demo-collapse-non-matches',
    icon: <IconCollapsedRow />,
    mode: 'collapse-non-matches',
    title: 'collapse-non-matches',
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.searchCollapseNonMatches,
  },
  {
    description: 'Keeps all items visible and expand folders with matches',
    id: 'file-tree-search-demo-expand-matches',
    icon: <IconFolderOpen />,
    mode: 'expand-matches',
    title: 'expand-matches',
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.searchExpandMatches,
  },
] as const;

function SearchModeTree({
  modeDemo,
  preloadedData,
}: {
  modeDemo: SearchModeDemo;
  preloadedData: FileTreePreloadedData;
}) {
  const { model } = useFileTree({
    fileTreeSearchMode: modeDemo.mode,
    flattenEmptyDirectories: true,
    id: modeDemo.id,
    initialSearchQuery: PREPOPULATED_SEARCH,
    paths: sampleFileList,
    search: true,
    viewportHeight: modeDemo.viewportHeight,
  });

  useEffect(() => {
    model.openSearch(PREPOPULATED_SEARCH);
    model.getItem(PRESELECTED_FILE)?.select();
  }, [model]);

  return (
    <div>
      <TreeExampleHeading
        icon={modeDemo.icon}
        description={modeDemo.description}
      >
        <code>{modeDemo.title}</code>
      </TreeExampleHeading>
      <FileTree
        className={DEFAULT_FILE_TREE_PANEL_CLASS}
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
              href={`${PRODUCTS.trees.docsPath}#core-types-filetreesearchmode`}
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SEARCH_MODE_DEMOS.map((modeDemo) => (
            <SearchModeTree
              key={modeDemo.id}
              modeDemo={modeDemo}
              preloadedData={preloadedDataById[modeDemo.id]}
            />
          ))}
        </div>
      </div>
    </TreeExampleSection>
  );
}
