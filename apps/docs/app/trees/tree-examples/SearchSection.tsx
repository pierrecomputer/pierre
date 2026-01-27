'use client';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreeApp } from '../TreeApp';
import { baseTreeOptions, SHARED_FILE_CONTENT } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

export function SearchSection() {
  return (
    <TreeExampleSection id="search">
      <FeatureHeader
        title="Search and filter by name"
        description="Filter the tree by typing in the search field. With fileTreeSearchMode: collapse-non-matches, only matching paths stay visible. Planned: dropdown with recent searches, fuzzy match, and “Jump to file” command palette."
      />
      <div className="space-y-4">
        <p className="text-muted-foreground border-border bg-muted/30 rounded-md border px-3 py-2 text-sm">
          <strong>Try it:</strong> Click the tree (or press a letter) to open
          search, then type e.g.{' '}
          <kbd className="border-border bg-muted rounded border px-1 font-mono text-xs">
            index
          </kbd>{' '}
          or{' '}
          <kbd className="border-border bg-muted rounded border px-1 font-mono text-xs">
            Button
          </kbd>
          . Only matching files and their parents remain visible.
        </p>
        <TreeApp
          fileTreeOptions={baseTreeOptions}
          fileContentMap={SHARED_FILE_CONTENT}
          defaultSelectedPath="build/index.mjs"
        />
      </div>
    </TreeExampleSection>
  );
}
