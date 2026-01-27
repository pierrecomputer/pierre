'use client';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreeApp } from '../TreeApp';
import { baseTreeOptions, SHARED_FILE_CONTENT } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

export function VirtualizationSection() {
  return (
    <TreeExampleSection id="virtualization">
      <FeatureHeader
        title="Virtualization"
        description="Only visible rows are rendered; scrolling loads more. Keeps DOM size small for huge trees. Optional windowing (fixed row height) or variable-height virtualization for mixed folder/file rows."
      />
      <TreeApp
        fileTreeOptions={baseTreeOptions}
        fileContentMap={SHARED_FILE_CONTENT}
        defaultSelectedPath="package.json"
      />
      <p className="text-muted-foreground text-sm">
        Draft: Virtualization will integrate with the headless tree to render
        only items in view. Planned: configurable row height and overscan for
        smooth scrolling.
      </p>
    </TreeExampleSection>
  );
}
