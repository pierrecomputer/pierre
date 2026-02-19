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
        description="Filter the tree by typing in the search field. Three fileTreeSearchMode options control how non-matching items are shown: expand-matches keeps all items visible and expands folders with matches; collapse-non-matches collapses folders that don't contain matches; hide-non-matches hides files and folders that don't contain matches. All three demos below start with search prepopulated."
      />
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <TreeExampleHeading icon={<IconFolderOpen />}>
              Expand matches
            </TreeExampleHeading>
            <p className="text-muted-foreground mb-2 text-sm">
              Expands folders containing matches but keeps all items visible
            </p>
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
            <TreeExampleHeading icon={<IconCollapsedRow />}>
              Collapse non-matches
            </TreeExampleHeading>
            <p className="text-muted-foreground mb-2 text-sm">
              Collapses folders not containing matches
            </p>
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
            <TreeExampleHeading icon={<IconEyeSlash />}>
              Hide non-matches
            </TreeExampleHeading>
            <p className="text-muted-foreground mb-2 text-sm">
              Hides files and folders that don't contain matches
            </p>
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
