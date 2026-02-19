'use client';

import { IconCursor, IconLock } from '@pierre/icons';
import { FileTree } from '@pierre/trees/react';
import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';

import { TreeExampleHeading } from '../../components/TreeExampleHeading';
import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { DEFAULT_FILE_TREE_PANEL_CLASS, dragDropOptions } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const dragDropStyle = {
  colorScheme: 'dark',
  '--ft-search-background': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

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
      <FileTree
        className={DEFAULT_FILE_TREE_PANEL_CLASS}
        options={options}
        style={dragDropStyle}
      />
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
          <TreeExampleHeading
            icon={<IconCursor />}
            description={
              <>
                Enable with <code>dragAndDrop: true</code>.
              </>
            }
          >
            Default
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            options={defaultOptions}
            style={dragDropStyle}
          />
        </div>
        <div>
          <TreeExampleHeading
            icon={<IconLock />}
            description={
              <>
                Use <code>lockedPaths</code> to prevent specific paths from
                being dragged.
              </>
            }
          >
            Control file updates
          </TreeExampleHeading>
          <LockedFileExample />
        </div>
      </div>
    </TreeExampleSection>
  );
}
