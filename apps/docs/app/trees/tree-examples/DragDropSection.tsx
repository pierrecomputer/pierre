'use client';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreeApp } from '../TreeApp';
import { baseTreeOptions, SHARED_FILE_CONTENT } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

export function DragDropSection() {
  return (
    <TreeExampleSection id="drag-drop">
      <FeatureHeader
        title="Drag and drop"
        description="Reorder or move files and folders via drag and drop. Optional: restrict to same level, or allow cross-folder moves. Reorderable lists and tree moves are planned with configurable validation and callbacks."
      />
      <TreeApp
        fileTreeOptions={baseTreeOptions}
        fileContentMap={SHARED_FILE_CONTENT}
        defaultSelectedPath="package.json"
      />
      <p className="text-muted-foreground text-sm">
        Draft: Drag-and-drop will expose onDragStart, onDrop, canDrop, and
        optional drop indicators. Works with both vanilla and React instances.
      </p>
    </TreeExampleSection>
  );
}
