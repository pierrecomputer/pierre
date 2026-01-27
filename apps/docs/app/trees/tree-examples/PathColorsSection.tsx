'use client';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreeApp } from '../TreeApp';
import { baseTreeOptions, SHARED_FILE_CONTENT } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

export function PathColorsSection() {
  return (
    <TreeExampleSection id="path-colors">
      <FeatureHeader
        title="Colored file paths (add / change / delete)"
        description="Style tree items by git status: added (green), modified (amber), deleted (red). Integrate with your diff or version control data to show change state per file. Coming: configurable status colors (e.g. --ft-status-added) and optional icons."
      />
      <div className="space-y-4">
        <p className="text-muted-foreground border-border bg-muted/30 rounded-md border px-3 py-2 text-sm">
          <strong>Live tree:</strong> Use the tree below to browse and select
          files. When path status colors ship, you’ll pass status per file and
          set CSS variables (e.g. --ft-status-added, --ft-status-modified) for
          consistent theming with diffs.
        </p>
        <TreeApp
          fileTreeOptions={baseTreeOptions}
          fileContentMap={SHARED_FILE_CONTENT}
          defaultSelectedPath="package.json"
        />
      </div>
    </TreeExampleSection>
  );
}
