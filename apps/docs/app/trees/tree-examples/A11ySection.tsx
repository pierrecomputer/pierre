'use client';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreeApp } from '../TreeApp';
import { baseTreeOptions, SHARED_FILE_CONTENT } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

export function A11ySection() {
  return (
    <TreeExampleSection id="a11y">
      <FeatureHeader
        title="Accessibility (a11y)"
        description="Keyboard navigation, focus management, and ARIA roles (tree, treeitem, group). Screen reader support for expand/collapse and selection. Meets WCAG 2.1 expectations for tree widgets."
      />
      <div className="space-y-4">
        <p className="text-muted-foreground border-border bg-muted/30 rounded-md border px-3 py-2 text-sm">
          <strong>Try it:</strong> Tab to focus the tree → Arrow keys to move →
          Enter to expand/collapse or open a file → Space to select. Focus ring
          and aria-expanded / aria-selected are wired.
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
