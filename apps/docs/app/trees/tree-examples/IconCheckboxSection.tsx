'use client';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreeApp } from '../TreeApp';
import { baseTreeOptions, SHARED_FILE_CONTENT } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

export function IconCheckboxSection() {
  return (
    <TreeExampleSection id="icon-checkbox">
      <FeatureHeader
        title="Icon and checkbox decoration"
        description="Custom icons per node type (file, folder, expanded/collapsed). Optional checkboxes for multi-select or “include in diff” workflows. Slot-based or config-driven icons and optional checkbox column."
      />
      <TreeApp
        fileTreeOptions={baseTreeOptions}
        fileContentMap={SHARED_FILE_CONTENT}
        defaultSelectedPath="package.json"
      />
      <p className="text-muted-foreground text-sm">
        Draft: Icon set is configurable (e.g. file, folder, chevron). Checkbox
        column with checked state and onChange will support bulk actions and
        diff inclusion.
      </p>
    </TreeExampleSection>
  );
}
