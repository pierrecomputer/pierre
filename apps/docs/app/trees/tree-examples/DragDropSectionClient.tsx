'use client';

import { IconLock, IconRefresh } from '@pierre/icons';
import { FileTree } from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { DEFAULT_FILE_TREE_PANEL_CLASS, dragDropOptions } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

const dragDropStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

export function DragDropSectionClient({
  prerenderedHTML,
}: {
  prerenderedHTML: string;
}) {
  const [lockPackageJson, setLockPackageJson] = useState(true);
  const [hasDragged, setHasDragged] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const options = useMemo(
    () => ({
      ...dragDropOptions(lockPackageJson ? ['package.json'] : undefined),
      id: 'drag-drop-demo-locked',
    }),
    [lockPackageJson]
  );

  const handleFilesChange = useCallback(() => {
    setHasDragged(true);
  }, []);

  const handleReset = useCallback(() => {
    setResetKey((k) => k + 1);
    setHasDragged(false);
  }, []);

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="drag-drop"
        title="Drag and drop"
        description={
          <>
            Move files and folders by dragging them onto other folders,
            flattened folders, or the root with <code>dragAndDrop: true</code>.
            Drop targets open automatically when you hover. Keyboard drag and
            drop is supported; dragging is disabled while search is active. Use{' '}
            <code>lockedPaths</code> to prevent specific paths from being
            dragged. Learn more in the{' '}
            <Link
              href="/preview/trees/docs#drag-and-drop"
              className="inline-link"
            >
              FileTreeOptions docs
            </Link>
            .
          </>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="gridstack">
            <Button
              variant="outline"
              className="w-full justify-between gap-3 pr-11 pl-3 md:w-auto"
              onClick={() => setLockPackageJson((prev) => !prev)}
            >
              <div className="flex items-center gap-2">
                <IconLock />
                Lock package.json
              </div>
            </Button>
            <Switch
              checked={lockPackageJson}
              onCheckedChange={setLockPackageJson}
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-none mr-3 place-self-center justify-self-end"
            />
          </div>
          <Button
            variant="outline"
            disabled={!hasDragged}
            onClick={handleReset}
          >
            <IconRefresh />
            Reset
          </Button>
        </div>

        <FileTree
          key={resetKey}
          className={DEFAULT_FILE_TREE_PANEL_CLASS}
          prerenderedHTML={prerenderedHTML}
          options={options}
          onFilesChange={handleFilesChange}
          style={dragDropStyle}
        />
      </div>
    </TreeExampleSection>
  );
}
