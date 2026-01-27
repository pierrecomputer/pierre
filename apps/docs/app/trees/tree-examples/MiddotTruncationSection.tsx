'use client';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreeApp } from '../TreeApp';
import { baseTreeOptions, SHARED_FILE_CONTENT } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

export function MiddotTruncationSection() {
  return (
    <TreeExampleSection id="middot-truncation">
      <FeatureHeader
        title="Middot truncation"
        description="Long paths shown as start · … · end (e.g. src · … · Button.tsx) when space is limited. Configurable min visible segments and ellipsis character. Keeps the tree readable in narrow sidebars."
      />
      <TreeApp
        fileTreeOptions={baseTreeOptions}
        fileContentMap={SHARED_FILE_CONTENT}
        defaultSelectedPath="build/assets/images/social/logo.png"
      />
      <p className="text-muted-foreground text-sm">
        Draft: Truncation will use CSS or a small layout pass to show leading
        and trailing path segments with a middot separator. Tooltip shows full
        path.
      </p>
    </TreeExampleSection>
  );
}
