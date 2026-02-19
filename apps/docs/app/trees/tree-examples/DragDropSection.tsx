'use client';

import { IconCursor, IconLock } from '@pierre/icons';
import { FileTree } from '@pierre/trees/react';
import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';

import { TreeExampleHeading } from '../../components/TreeExampleHeading';
import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreePanel } from '../TreePanel';
import { dragDropOptions } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

/** Example 1: default drag and drop — all items draggable. */
const defaultOptions = {
  ...dragDropOptions(),
  id: 'drag-drop-demo-default',
};

/** Example 2: locked file — pass lockedPaths so package.json cannot be dragged. */
function LockedFileExample() {
  const [lockPackageJson, setLockPackageJson] = useState(true);
  const options = useMemo(
    () => ({
      ...dragDropOptions(lockPackageJson ? ['package.json'] : undefined),
      id: 'drag-drop-demo-locked',
    }),
    [lockPackageJson]
  );
  return (
    <div className="flex flex-col gap-3">
      <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={lockPackageJson}
          onChange={(e) => setLockPackageJson(e.target.checked)}
          className="rounded border-neutral-600"
        />
        Lock package.json
      </label>
      <TreePanel>
        <FileTree
          className="[--ft-search-background:theme(colors.neutral.800)]"
          options={options}
          style={
            {
              colorScheme: 'dark',
              '--ft-search-background': 'light-dark(#fff, oklch(14.5% 0 0))',
            } as CSSProperties
          }
        />
      </TreePanel>
    </div>
  );
}

export function DragDropSection() {
  return (
    <TreeExampleSection id="drag-drop">
      <FeatureHeader
        title="Drag and drop"
        description="Move files and folders by dragging them onto other folders or the root. Drop targets open automatically when you hover. Keyboard drag and drop is supported; dragging is disabled while search is active."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <TreeExampleHeading icon={<IconCursor />}>Default</TreeExampleHeading>
          <TreePanel>
            <FileTree
              className="[--ft-search-background:theme(colors.neutral.800)]"
              options={defaultOptions}
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
          <TreeExampleHeading icon={<IconLock />}>
            With locked file
          </TreeExampleHeading>
          <LockedFileExample />
        </div>
      </div>

      <p className="text-muted-foreground text-sm">
        Enable with <code>dragAndDrop: true</code>. Use <code>lockedPaths</code>{' '}
        to prevent specific paths from being dragged. Controlled mode:{' '}
        <code>files</code> + <code>onFilesChange</code>; optional{' '}
        <code>onCollision</code> for overwrite behavior.
      </p>
    </TreeExampleSection>
  );
}
