'use client';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreeApp } from '../TreeApp';
import { baseTreeOptions, SHARED_FILE_CONTENT } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

export function BTreeSection() {
  return (
    <TreeExampleSection id="b-tree">
      <FeatureHeader
        title="Fancy tech: B-tree"
        description="Under the hood, the tree can use a B-tree–style structure for O(log n) expand/collapse and search in very large datasets. Optional for apps that need maximum performance on 10k+ nodes."
      />
      <TreeApp
        fileTreeOptions={baseTreeOptions}
        fileContentMap={SHARED_FILE_CONTENT}
        defaultSelectedPath="package.json"
      />
      <p className="text-muted-foreground text-sm">
        Draft: B-tree (or similar) indexing is planned for large monorepos:
        faster search, expand, and selection without full linear scans. Today
        the tree uses a flat file list and in-memory tree; B-tree would sit
        behind the same public API.
      </p>
    </TreeExampleSection>
  );
}
