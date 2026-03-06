'use client';

import { IconCollapsedRow, IconEyeSlash, IconFolderOpen } from '@pierre/icons';
import { FileTree } from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { TreeExampleHeading } from '../../components/TreeExampleHeading';
import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { DEFAULT_FILE_TREE_PANEL_CLASS, searchOptions } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

const PREPOPULATED_SEARCH = 'tsx';
const PRESELECTED_FILE = 'src/components/Button.tsx';

const searchModeStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

export function SearchSection() {
  return (
    <TreeExampleSection id="search">
      <FeatureHeader
        title="Search and filter by name"
        description={
          <>
            Filter the tree by typing in the search field. Trees includes three{' '}
            <Link
              href="/trees/docs#core-types-filetreesearchmode"
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
          <div>
            <TreeExampleHeading
              icon={<IconFolderOpen />}
              description="Keeps all items visible and expand folders with matches"
            >
              <code>expand-matches</code>
            </TreeExampleHeading>
            <FileTree
              className={DEFAULT_FILE_TREE_PANEL_CLASS}
              options={{
                ...searchOptions('expand-matches'),
                id: 'search-demo-expand-matches',
              }}
              initialSearchQuery={PREPOPULATED_SEARCH}
              initialSelectedItems={[PRESELECTED_FILE]}
              style={searchModeStyle}
            />
          </div>
          <div>
            <TreeExampleHeading
              icon={<IconCollapsedRow />}
              description="Collapses folders without any matches"
            >
              <code>collapse-non-matches</code>
            </TreeExampleHeading>
            <FileTree
              className={DEFAULT_FILE_TREE_PANEL_CLASS}
              options={{
                ...searchOptions('collapse-non-matches'),
                id: 'search-demo-collapse-non-matches',
              }}
              initialSearchQuery={PREPOPULATED_SEARCH}
              initialSelectedItems={[PRESELECTED_FILE]}
              style={searchModeStyle}
            />
          </div>
          <div>
            <TreeExampleHeading
              icon={<IconEyeSlash />}
              description="Hides files and folders without any matches"
            >
              <code>hide-non-matches</code>
            </TreeExampleHeading>
            <FileTree
              className={DEFAULT_FILE_TREE_PANEL_CLASS}
              options={{
                ...searchOptions('hide-non-matches'),
                id: 'search-demo-hide-non-matches',
              }}
              initialSearchQuery={PREPOPULATED_SEARCH}
              initialSelectedItems={[PRESELECTED_FILE]}
              style={searchModeStyle}
            />
          </div>
        </div>
      </div>
    </TreeExampleSection>
  );
}
