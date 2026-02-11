'use client';

import { FileTree } from '@pierre/file-tree/react';
import { IconFileTreeFill, IconFolders } from '@pierre/icons';
import type { CSSProperties } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreePanel } from '../TreePanel';
import { flatteningOptions } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

export function FlatteningSection() {
  return (
    <TreeExampleSection id="flatten">
      <FeatureHeader
        title="Flatten empty directories"
        description="Collapse single-child folder chains into a single item to save clicks and improve user experience. Compare the two views below: hierarchical (nested folders) vs flattened (single-child chains collapsed into one row)."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-lg font-medium">
            <IconFileTreeFill />
            Hierarchical
          </h3>
          <TreePanel>
            <FileTree
              className="[--ft-search-background:theme(colors.neutral.800)]"
              options={{
                ...flatteningOptions(false),
                id: 'flatten-demo-hierarchical',
              }}
              style={
                {
                  colorScheme: 'dark',
                  '--ft-search-background':
                    'light-dark(#fff, oklch(14.5% 0 0))',
                } as CSSProperties
              }
            />
          </TreePanel>
        </div>
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-lg font-medium">
            <IconFolders />
            Flattened
          </h3>
          <TreePanel>
            <FileTree
              className="[--ft-search-background:theme(colors.neutral.800)]"
              options={{
                ...flatteningOptions(true),
                id: 'flatten-demo-flattened',
              }}
              style={
                {
                  colorScheme: 'dark',
                  '--ft-search-background':
                    'light-dark(#fff, oklch(14.5% 0 0))',
                } as CSSProperties
              }
            />
          </TreePanel>
        </div>
      </div>
    </TreeExampleSection>
  );
}
