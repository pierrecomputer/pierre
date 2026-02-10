'use client';

import { IconBulbFill, IconCollapsedRow, IconExpandRow } from '@pierre/icons';
import { startTransition, useState } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreeApp } from '../TreeApp';
import { searchOptions, SHARED_FILE_CONTENT } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

const SEARCH_MODES = [
  {
    value: 'expand-matches' as const,
    label: 'Expand matches',
    Icon: IconExpandRow,
  },
  {
    value: 'collapse-non-matches' as const,
    label: 'Collapse non-matches',
    Icon: IconCollapsedRow,
  },
] as const;

export function SearchSection() {
  const [mode, setMode] = useState<'expand-matches' | 'collapse-non-matches'>(
    'collapse-non-matches'
  );
  return (
    <TreeExampleSection id="search">
      <FeatureHeader
        title="Search and filter by name"
        description="Filter the tree by typing in the search field. With fileTreeSearchMode: collapse-non-matches, only matching paths stay visible. Planned: dropdown with recent searches, fuzzy match, and “Jump to file” command palette."
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <ButtonGroup
            value={mode}
            onValueChange={(value: string) =>
              startTransition(() =>
                setMode(value as 'expand-matches' | 'collapse-non-matches')
              )
            }
          >
            {SEARCH_MODES.map((m) => (
              <ButtonGroupItem key={m.value} value={m.value}>
                <m.Icon className="shrink-0" />
                {m.label}
              </ButtonGroupItem>
            ))}
          </ButtonGroup>
          <p className="text-muted-foreground border-border bg-muted/30 flex items-center gap-2 rounded-md border px-3 py-2 text-sm md:ml-auto">
            <IconBulbFill />
            Focus into the tree and type to start searching, or focus the input.
          </p>
        </div>
        <TreeApp
          fileTreeOptions={searchOptions(mode)}
          fileContentMap={SHARED_FILE_CONTENT}
          defaultSelectedPath="build/index.mjs"
          showSearch
        />
      </div>
    </TreeExampleSection>
  );
}
