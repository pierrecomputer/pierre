'use client';

import type {
  ContextMenuTriggerMode,
  FileTreeCompositionOptions,
} from '@pierre/trees';
import { type FileTreePreloadedData, useFileTree } from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { FeatureHeader } from '../diff-examples/FeatureHeader';
import { sampleFileList } from './demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
import { PRODUCTS } from '@/app/product-config';
import { TreeApp } from '@/components/TreeApp';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

const CONTEXT_MENU_EXPANDED_PATHS = ['src', 'src/components'] as const;
const contextMenuPanelStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;
const IDE_WINDOW_HEIGHT = TREE_NEW_VIEWPORT_HEIGHTS.contextMenu;

interface TriggerModeDemo {
  id: string;
  mode: ContextMenuTriggerMode;
  title: string;
}

const TRIGGER_MODE_DEMOS: readonly TriggerModeDemo[] = [
  {
    id: 'file-tree-context-menu-demo-both',
    mode: 'both',
    title: 'Both',
  },
  {
    id: 'file-tree-context-menu-demo-right-click',
    mode: 'right-click',
    title: 'Right click',
  },
  {
    id: 'file-tree-context-menu-demo-button',
    mode: 'button',
    title: 'Button',
  },
] as const;

interface DemoContextMenuClientProps {
  preloadedDataById: Readonly<Record<string, FileTreePreloadedData>>;
}

function getProjectNameForMode(mode: ContextMenuTriggerMode): string {
  switch (mode) {
    case 'button':
      return 'Button Trigger Project';
    case 'right-click':
      return 'Right Click Project';
    default:
      return 'example';
  }
}

// The composition only needs to wire up the trigger mode + enable the menu;
// TreeApp now owns the actual menu UI and the new file/folder/rename/delete
// mutations. The render slot is intentionally absent so the React FileTree
// component can take over via its renderContextMenu prop.
function buildContextMenuComposition(
  triggerMode: ContextMenuTriggerMode
): FileTreeCompositionOptions {
  return {
    contextMenu: {
      enabled: true,
      triggerMode,
    },
  };
}

export function DemoContextMenuClient({
  preloadedDataById,
}: DemoContextMenuClientProps) {
  const [activeMode, setActiveMode] = useState<ContextMenuTriggerMode>('both');
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  );

  useEffect(() => {
    setPortalContainer(document.getElementById('dark-mode-portal-container'));
  }, []);

  const modeByName = useMemo(
    () =>
      new Map<ContextMenuTriggerMode, TriggerModeDemo>(
        TRIGGER_MODE_DEMOS.map((modeDemo) => [modeDemo.mode, modeDemo])
      ),
    []
  );
  const activeModeDemo = modeByName.get(activeMode) ?? TRIGGER_MODE_DEMOS[0];

  const bothComposition = useMemo(
    () => buildContextMenuComposition('both'),
    []
  );
  const rightClickComposition = useMemo(
    () => buildContextMenuComposition('right-click'),
    []
  );
  const buttonComposition = useMemo(
    () => buildContextMenuComposition('button'),
    []
  );

  const { model: bothModel } = useFileTree({
    composition: bothComposition,
    flattenEmptyDirectories: true,
    id: 'file-tree-context-menu-demo-both',
    initialExpandedPaths: CONTEXT_MENU_EXPANDED_PATHS,
    paths: sampleFileList,
    renaming: true,
    search: false,
    initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.contextMenu / 30,
  });
  const { model: rightClickModel } = useFileTree({
    composition: rightClickComposition,
    flattenEmptyDirectories: true,
    id: 'file-tree-context-menu-demo-right-click',
    initialExpandedPaths: CONTEXT_MENU_EXPANDED_PATHS,
    paths: sampleFileList,
    renaming: true,
    search: false,
    initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.contextMenu / 30,
  });
  const { model: buttonModel } = useFileTree({
    composition: buttonComposition,
    flattenEmptyDirectories: true,
    id: 'file-tree-context-menu-demo-button',
    initialExpandedPaths: CONTEXT_MENU_EXPANDED_PATHS,
    paths: sampleFileList,
    renaming: true,
    search: false,
    initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.contextMenu / 30,
  });

  const activeModel =
    activeMode === 'right-click'
      ? rightClickModel
      : activeMode === 'button'
        ? buttonModel
        : bothModel;

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="context-menu"
        title="Context menu composition"
        description={
          <>
            Render a custom context menu with{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#rename-drag-and-trigger-item-actions-add-a-context-menu-as-an-optional-command-surface`}
              className="inline-link"
            >
              <code>composition.contextMenu</code>
            </Link>{' '}
            and the React <code>renderContextMenu</code> prop. . This demo
            exposes trigger modes for right-click, trigger button, or both, and
            menu actions for new files, new folders, rename, and delete.
          </>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <ButtonGroup
            value={activeMode}
            onValueChange={(value) =>
              setActiveMode(value as ContextMenuTriggerMode)
            }
          >
            {TRIGGER_MODE_DEMOS.map((modeDemo) => (
              <ButtonGroupItem key={modeDemo.id} value={modeDemo.mode}>
                {modeDemo.title}
              </ButtonGroupItem>
            ))}
          </ButtonGroup>
          <Button
            variant="outline"
            onClick={() => {
              bothModel.resetPaths(sampleFileList, {
                initialExpandedPaths: CONTEXT_MENU_EXPANDED_PATHS,
              });
              rightClickModel.resetPaths(sampleFileList, {
                initialExpandedPaths: CONTEXT_MENU_EXPANDED_PATHS,
              });
              buttonModel.resetPaths(sampleFileList, {
                initialExpandedPaths: CONTEXT_MENU_EXPANDED_PATHS,
              });
            }}
          >
            Reset demo tree
          </Button>
        </div>
        <TreeApp
          key={activeModeDemo.id}
          contextMenuPortalContainer={portalContainer}
          height={IDE_WINDOW_HEIGHT}
          model={activeModel}
          preloadedTreeData={preloadedDataById[activeModeDemo.id]}
          projectName={getProjectNameForMode(activeMode)}
          showTabs={false}
          treeClassName="dark h-full min-h-0 overflow-auto p-2"
          treeStyle={contextMenuPanelStyle}
          renderEmpty={() => (
            <div className="flex flex-1 items-center justify-center px-6 text-sm text-zinc-500">
              Editor canvas intentionally empty.
            </div>
          )}
        />
      </div>
    </TreeExampleSection>
  );
}
