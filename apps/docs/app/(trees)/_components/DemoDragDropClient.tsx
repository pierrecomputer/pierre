'use client';

import { IconLock, IconRefresh } from '@pierre/icons';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import type { FileTreePathOptions } from '@trees/_lib/fileTreePathOptions';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { sampleFileList } from '../_lib/demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from '../_lib/dimensions';
import { getDefaultFileTreePanelClass } from './tree-examples/demo-data';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
import { FeatureHeader } from '@/components/FeatureHeader';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { PRODUCTS } from '@/lib/product-config';

const dragDropStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

const DRAG_DROP_BASE_OPTIONS: Omit<FileTreePathOptions, 'id' | 'paths'> = {
  dragAndDrop: true,
  flattenEmptyDirectories: true,
  search: false,
  initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.dragDrop / 30,
};

interface DemoDragDropClientProps {
  preloadedData: {
    locked: FileTreePreloadedData;
    unlocked: FileTreePreloadedData;
  };
}

export function DemoDragDropClient({ preloadedData }: DemoDragDropClientProps) {
  const [lockPackageJson, setLockPackageJson] = useState(true);
  const [hasDragged, setHasDragged] = useState(false);
  const { model: lockedModel } = useFileTree({
    ...DRAG_DROP_BASE_OPTIONS,
    dragAndDrop: {
      canDrag: (draggedPaths) =>
        draggedPaths.includes('package.json') === false,
      onDropComplete: () => {
        setHasDragged(true);
      },
    },
    id: 'file-tree-drag-drop-demo-locked',
    paths: sampleFileList,
    renderRowDecoration: ({ item }) =>
      item.path === 'package.json'
        ? { icon: 'file-tree-icon-lock', title: 'Locked file' }
        : null,
  });
  const { model: unlockedModel } = useFileTree({
    ...DRAG_DROP_BASE_OPTIONS,
    dragAndDrop: {
      onDropComplete: () => {
        setHasDragged(true);
      },
    },
    id: 'file-tree-drag-drop-demo-unlocked',
    paths: sampleFileList,
  });

  const activeModel = lockPackageJson ? lockedModel : unlockedModel;
  const activePreloadedData = lockPackageJson
    ? preloadedData.locked
    : preloadedData.unlocked;

  useEffect(() => {
    activeModel.resetPaths(sampleFileList);
    setHasDragged(false);
  }, [activeModel]);

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="drag-drop"
        title="Drag and drop"
        description={
          <>
            Set <code>dragAndDrop: true</code> to move files and folders. Drag
            them onto other folders, flattened folders, or the root. Drop
            targets open automatically when you hover. The tree disables
            dragging while search is active. Pass a <code>canDrag</code>{' '}
            callback to lock specific paths. Learn more in the{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#rename-drag-and-trigger-item-actions-move-items-with-drag-and-drop`}
              className="inline-link"
            >
              item actions guide
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
              onClick={() => setLockPackageJson((previous) => !previous)}
            >
              <div className="flex items-center gap-2">
                <IconLock />
                Lock package.json
              </div>
            </Button>
            <Switch
              checked={lockPackageJson}
              onCheckedChange={setLockPackageJson}
              onClick={(event) => event.stopPropagation()}
              className="pointer-events-none mr-3 place-self-center justify-self-end"
            />
          </div>
          <Button
            className="ml-auto md:ml-0"
            variant="outline"
            disabled={!hasDragged}
            onClick={() => {
              activeModel.resetPaths(sampleFileList);
              setHasDragged(false);
            }}
          >
            <IconRefresh />
            Reset
          </Button>
        </div>

        <FileTree
          className={getDefaultFileTreePanelClass()}
          model={activeModel}
          preloadedData={activePreloadedData}
          style={{
            ...dragDropStyle,
            height: `${String(TREE_NEW_VIEWPORT_HEIGHTS.dragDrop)}px`,
          }}
        />
      </div>
    </TreeExampleSection>
  );
}
