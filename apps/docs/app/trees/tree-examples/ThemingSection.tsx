'use client';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreeApp } from '../TreeApp';
import { baseTreeOptions, SHARED_FILE_CONTENT } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

export function ThemingSection() {
  return (
    <TreeExampleSection id="theming">
      <FeatureHeader
        title="Theming"
        description="CSS custom properties on the host: --ft-color-foreground, --ft-search-background, --ft-color-border, --ft-selected-background-color, and more. Tree and code viewer follow your system or app light/dark theme."
      />
      <div className="space-y-4">
        <p className="text-muted-foreground border-border bg-muted/30 rounded-md border px-3 py-2 text-sm">
          <strong>Try it:</strong> Toggle your system or browser light/dark
          theme. The tree sidebar and the code viewer on the right both update
          (e.g. search field and syntax highlighting).
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
