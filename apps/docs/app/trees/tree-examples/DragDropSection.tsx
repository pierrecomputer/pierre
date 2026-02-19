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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const defaultOptions = {
  ...dragDropOptions(),
  id: 'drag-drop-demo-default',
};

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
    <div className="flex flex-col-reverse gap-3">
      <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <Switch
          id="lock-package-json"
          checked={lockPackageJson}
          onCheckedChange={setLockPackageJson}
        />
        <Label htmlFor="lock-package-json" className="cursor-pointer">
          Lock package.json
        </Label>
      </div>
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
        description={
          <>
            Move files and folders by dragging them onto other folders or the
            root. Drop targets open automatically when you hover. Keyboard drag
            and drop is supported; dragging is disabled while search is active.
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <TreeExampleHeading icon={<IconCursor />}>Default</TreeExampleHeading>
          <p className="text-muted-foreground -mt-2 mb-3 text-sm">
            Enable with <code>dragAndDrop: true</code>.
          </p>
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
          <p className="text-muted-foreground -mt-2 mb-3 text-sm">
            Use <code>lockedPaths</code> to prevent specific paths from being
            dragged.
          </p>
          <LockedFileExample />
        </div>
      </div>
    </TreeExampleSection>
  );
}
