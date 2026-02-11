'use client';

import { FileTree } from '@pierre/file-tree/react';
import { IconCollapsedRow, IconExpandRow } from '@pierre/icons';
import type { CSSProperties } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreePanel } from '../TreePanel';
import { searchOptions } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

const PREPOPULATED_SEARCH = 'ind';

export function SearchSection() {
  return (
    <TreeExampleSection id="search">
      <FeatureHeader
        title="Search and filter by name"
        description="Filter the tree by typing in the search field. With fileTreeSearchMode: collapse-non-matches, only matching paths stay visible. Compare the two modes below; both start with search prepopulated."
      />
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-medium">
              <IconExpandRow className="shrink-0" />
              Expand matches
            </h3>
            <TreePanel>
              <FileTree
                className="[--ft-search-background:theme(colors.neutral.800)]"
                options={{
                  ...searchOptions('expand-matches', PREPOPULATED_SEARCH),
                  id: 'search-demo-expand-matches',
                  showSearch: true,
                }}
                style={
                  {
                    colorScheme: 'dark',
                    '--ft-search-background':
                      'light-dark(#fff, oklch(14.5% 0 0))',
                  } as CSSProperties
                }
              />
            </TreePanel>
          </div>
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-medium">
              <IconCollapsedRow className="shrink-0" />
              Collapse non-matches
            </h3>
            <TreePanel>
              <FileTree
                className="[--ft-search-background:theme(colors.neutral.800)]"
                options={{
                  ...searchOptions('collapse-non-matches', PREPOPULATED_SEARCH),
                  id: 'search-demo-collapse-non-matches',
                  showSearch: true,
                }}
                style={
                  {
                    colorScheme: 'dark',
                    '--ft-search-background':
                      'light-dark(#fff, oklch(14.5% 0 0))',
                  } as CSSProperties
                }
              />
            </TreePanel>
          </div>
        </div>
      </div>
    </TreeExampleSection>
  );
}
