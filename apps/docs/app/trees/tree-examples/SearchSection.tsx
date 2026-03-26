import { IconCollapsedRow, IconEyeSlash, IconFolderOpen } from '@pierre/icons';
import { FileTree } from '@pierre/trees/react';
import { preloadFileTree } from '@pierre/trees/ssr';
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

function createSearchPrerenderedHTML(
  mode: 'hide-non-matches' | 'collapse-non-matches' | 'expand-matches',
  id: string
): string {
  return preloadFileTree(
    {
      ...searchOptions(mode),
      id,
    },
    {
      initialSearchQuery: PREPOPULATED_SEARCH,
      initialSelectedItems: [PRESELECTED_FILE],
    }
  ).shadowHtml;
}

const hideNonMatchesPrerenderedHTML = createSearchPrerenderedHTML(
  'hide-non-matches',
  'search-demo-hide-non-matches'
);
const collapseNonMatchesPrerenderedHTML = createSearchPrerenderedHTML(
  'collapse-non-matches',
  'search-demo-collapse-non-matches'
);
const expandMatchesPrerenderedHTML = createSearchPrerenderedHTML(
  'expand-matches',
  'search-demo-expand-matches'
);

export function SearchSection() {
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
              href="/preview/trees/docs#core-types-filetreesearchmode"
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
        <div className="grid min-h-[934px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <TreeExampleHeading
              icon={<IconEyeSlash />}
              description="Hides files and folders without any matches"
            >
              <code>hide-non-matches</code>
            </TreeExampleHeading>
            <FileTree
              className={DEFAULT_FILE_TREE_PANEL_CLASS}
              prerenderedHTML={hideNonMatchesPrerenderedHTML}
              options={{
                ...searchOptions('hide-non-matches'),
                id: 'search-demo-hide-non-matches',
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
              prerenderedHTML={collapseNonMatchesPrerenderedHTML}
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
              icon={<IconFolderOpen />}
              description="Keeps all items visible and expand folders with matches"
            >
              <code>expand-matches</code>
            </TreeExampleHeading>
            <FileTree
              className={DEFAULT_FILE_TREE_PANEL_CLASS}
              prerenderedHTML={expandMatchesPrerenderedHTML}
              options={{
                ...searchOptions('expand-matches'),
                id: 'search-demo-expand-matches',
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
