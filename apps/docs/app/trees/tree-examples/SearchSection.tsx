'use client';

import { IconCollapsedRow, IconEyeSlash, IconFolderOpen } from '@pierre/icons';
import { FileTree } from '@pierre/trees/react';
import type { CSSProperties } from 'react';

import { TreeExampleHeading } from '../../components/TreeExampleHeading';
import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreePanel } from '../TreePanel';
import { searchOptions } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

const PREPOPULATED_SEARCH = 'tsx';

const searchModeStyle = {
  colorScheme: 'dark',
  '--ft-search-background': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

export function SearchSection() {
  return (
    <TreeExampleSection id="search">
      <FeatureHeader
        title="Search and filter by name"
        description={
          <>
            Filter the tree by typing in the search field. Trees includes three{' '}
            <code>fileTreeSearchMode</code> options to control how non-matching
            items are shown. All three demos below start with search
            prepopulated to show the different modes.
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
            <TreePanel>
              <FileTree
                className="[--ft-search-background:theme(colors.neutral.800)]"
                options={{
                  ...searchOptions('expand-matches'),
                  id: 'search-demo-expand-matches',
                }}
                initialSearch={PREPOPULATED_SEARCH}
                style={searchModeStyle}
              />
            </TreePanel>
          </div>
          <div>
            <TreeExampleHeading
              icon={<IconCollapsedRow />}
              description="Collapses folders without any matches"
            >
              <code>collapse-non-matches</code>
            </TreeExampleHeading>
            <TreePanel>
              <FileTree
                className="[--ft-search-background:theme(colors.neutral.800)]"
                options={{
                  ...searchOptions('collapse-non-matches'),
                  id: 'search-demo-collapse-non-matches',
                }}
                initialSearch={PREPOPULATED_SEARCH}
                style={searchModeStyle}
              />
            </TreePanel>
          </div>
          <div>
            <TreeExampleHeading
              icon={<IconEyeSlash />}
              description="Hides files and folders without any matches"
            >
              <code>hide-non-matches</code>
            </TreeExampleHeading>
            <TreePanel>
              <FileTree
                className="[--ft-search-background:theme(colors.neutral.800)]"
                options={{
                  ...searchOptions('hide-non-matches'),
                  id: 'search-demo-hide-non-matches',
                }}
                initialSearch={PREPOPULATED_SEARCH}
                style={searchModeStyle}
              />
            </TreePanel>
          </div>
        </div>
      </div>
    </TreeExampleSection>
  );
}
