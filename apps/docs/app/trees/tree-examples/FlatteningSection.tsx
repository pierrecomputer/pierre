'use client';

import { IconFileTreeFill, IconFolders } from '@pierre/icons';
import { FileTree } from '@pierre/trees/react';
import type { CSSProperties } from 'react';

import { TreeExampleHeading } from '../../components/TreeExampleHeading';
import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { DEFAULT_FILE_TREE_PANEL_CLASS, flatteningOptions } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

const flattenStyle = {
  colorScheme: 'dark',
  '--ft-search-background': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

export function FlatteningSection() {
  return (
    <TreeExampleSection id="flatten">
      <FeatureHeader
        title="Flatten empty directories"
        description="Collapse single-child folder chains into a single item to save clicks and improve user experience. Compare the two views below: hierarchical (nested folders) vs flattened (single-child chains collapsed into one row)."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <TreeExampleHeading icon={<IconFileTreeFill />}>
            Hierarchical
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            options={{
              ...flatteningOptions(false),
              id: 'flatten-demo-hierarchical',
            }}
            initialExpandedItems={[
              'build',
              'build/assets',
              'build/assets/images',
              'build/assets/images/social',
            ]}
            style={flattenStyle}
          />
        </div>
        <div>
          <TreeExampleHeading icon={<IconFolders />}>
            Flattened
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            options={{
              ...flatteningOptions(true),
              id: 'flatten-demo-flattened',
            }}
            initialExpandedItems={['build', 'f::build/assets/images/social']}
            style={flattenStyle}
          />
        </div>
      </div>
    </TreeExampleSection>
  );
}
