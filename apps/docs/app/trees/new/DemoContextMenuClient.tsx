'use client';

import type {
  PathStoreFileTree,
  PathStoreTreesContextMenuItem,
  PathStoreTreesContextMenuOpenContext,
  PathStoreTreesContextMenuTriggerMode,
} from '@pierre/trees/path-store';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/path-store/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { createRoot, type Root as ReactDomRoot } from 'react-dom/client';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { sampleFileList } from '../demo-data';
import { TreeExampleSection } from '../tree-examples/TreeExampleSection';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { PRODUCTS } from '@/app/product-config';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

const CONTEXT_MENU_EXPANDED_PATHS = ['src', 'src/components'] as const;
const contextMenuPanelStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;
const IDE_WINDOW_HEIGHT = TREE_NEW_VIEWPORT_HEIGHTS.contextMenu;
const IDE_EXPLORER_WIDTH_PX = 300;

interface TriggerModeDemo {
  id: string;
  mode: PathStoreTreesContextMenuTriggerMode;
  title: string;
}

const TRIGGER_MODE_DEMOS: readonly TriggerModeDemo[] = [
  {
    id: 'path-store-context-menu-demo-both',
    mode: 'both',
    title: 'both',
  },
  {
    id: 'path-store-context-menu-demo-right-click',
    mode: 'right-click',
    title: 'right-click',
  },
  {
    id: 'path-store-context-menu-demo-button',
    mode: 'button',
    title: 'button',
  },
] as const;

interface DemoContextMenuClientProps {
  preloadedDataById: Readonly<Record<string, FileTreePreloadedData>>;
}

function LocalProjectHeader({
  projectName,
  onAddFile,
  onAddFolder,
}: {
  projectName: string;
  onAddFile: () => void;
  onAddFolder: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#232323] px-2 py-1.5">
      <div className="min-w-0 truncate text-xs font-semibold text-zinc-200">
        {projectName}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="New file"
          onClick={onAddFile}
          className="h-5 w-5 rounded text-xs text-zinc-300 hover:bg-white/10"
        >
          +
        </button>
        <button
          type="button"
          title="New folder"
          onClick={onAddFolder}
          className="h-5 w-5 rounded text-xs text-zinc-300 hover:bg-white/10"
        >
          #
        </button>
      </div>
    </div>
  );
}

function getParentPath(path: string): string {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex < 0
    ? ''
    : `${normalizedPath.slice(0, lastSlashIndex + 1)}`;
}

function getUniquePath(model: PathStoreFileTree, basePath: string): string {
  let suffix = 0;
  let candidate = basePath;
  while (model.getItem(candidate) != null) {
    suffix += 1;
    if (basePath.endsWith('/')) {
      candidate = `${basePath.slice(0, -1)}-${String(suffix)}/`;
      continue;
    }

    const dotIndex = basePath.lastIndexOf('.');
    const slashIndex = basePath.lastIndexOf('/');
    if (dotIndex > slashIndex) {
      candidate = `${basePath.slice(0, dotIndex)}-${String(suffix)}${basePath.slice(dotIndex)}`;
      continue;
    }

    candidate = `${basePath}-${String(suffix)}`;
  }
  return candidate;
}

function ContextMenuContents({
  context,
  item,
  onAddFile,
  onAddFolder,
  onDelete,
  onRename,
}: {
  context: Pick<PathStoreTreesContextMenuOpenContext, 'close' | 'restoreFocus'>;
  item: PathStoreTreesContextMenuItem;
  onAddFile: () => void;
  onAddFolder: () => void;
  onDelete: () => void;
  onRename: () => void;
}) {
  const itemType = item.kind === 'directory' ? 'Folder' : 'File';
  const closeAfter = (action: () => void) => {
    action();
    context.close();
  };

  return (
    <div
      data-path-store-context-menu-root="true"
      role="menu"
      className="bg-popover text-popover-foreground min-w-[230px] overflow-hidden rounded-md border shadow-md"
    >
      <div className="max-w-[300px] truncate px-2 py-1.5 text-sm font-semibold">
        {itemType}: {item.path}
      </div>
      <div className="bg-border h-px" />
      <button
        type="button"
        role="menuitem"
        className="hover:bg-accent hover:text-accent-foreground w-full px-2 py-1.5 text-left text-sm"
        onClick={() => {
          closeAfter(onAddFile);
        }}
      >
        New file
      </button>
      <button
        type="button"
        role="menuitem"
        className="hover:bg-accent hover:text-accent-foreground w-full px-2 py-1.5 text-left text-sm"
        onClick={() => {
          closeAfter(onAddFolder);
        }}
      >
        New folder
      </button>
      <div className="bg-border h-px" />
      <button
        type="button"
        role="menuitem"
        className="hover:bg-accent hover:text-accent-foreground w-full px-2 py-1.5 text-left text-sm"
        onClick={() => {
          context.close({ restoreFocus: false });
          onRename();
        }}
      >
        Rename
      </button>
      <button
        type="button"
        role="menuitem"
        className="text-destructive hover:bg-accent hover:text-destructive w-full px-2 py-1.5 text-left text-sm"
        onClick={() => {
          closeAfter(onDelete);
        }}
      >
        Delete
      </button>
    </div>
  );
}

function useContextMenuSlotRenderer(modelRef: {
  current: PathStoreFileTree | null;
}) {
  const slotElementRef = useRef<HTMLDivElement | null>(null);
  const menuRootRef = useRef<ReactDomRoot | null>(null);

  return useCallback(
    (
      item: PathStoreTreesContextMenuItem,
      context: PathStoreTreesContextMenuOpenContext
    ) => {
      const slotElement =
        slotElementRef.current ?? document.createElement('div');
      slotElementRef.current = slotElement;
      slotElement.style.display = 'block';
      menuRootRef.current ??= createRoot(slotElement);

      const model = modelRef.current;
      if (model == null) {
        return slotElement;
      }

      const baseDirectoryPath =
        item.kind === 'directory' ? item.path : getParentPath(item.path);

      const addFile = () => {
        const nextPath = getUniquePath(
          model,
          `${baseDirectoryPath}new-file.ts`
        );
        model.add(nextPath);
      };
      const addFolder = () => {
        const nextPath = getUniquePath(
          model,
          `${baseDirectoryPath}new-folder/`
        );
        model.add(nextPath);
      };
      const rename = () => {
        model.startRenaming(item.path);
      };
      const remove = () => {
        model.remove(
          item.path,
          item.kind === 'directory' ? { recursive: true } : undefined
        );
      };

      menuRootRef.current.render(
        <ContextMenuContents
          context={context}
          item={item}
          onAddFile={addFile}
          onAddFolder={addFolder}
          onDelete={remove}
          onRename={rename}
        />
      );

      return slotElement;
    },
    [modelRef]
  );
}

function useHeaderSlotRenderer(
  modelRef: { current: PathStoreFileTree | null },
  projectName: string
) {
  const slotElementRef = useRef<HTMLDivElement | null>(null);
  const headerRootRef = useRef<ReactDomRoot | null>(null);

  return useCallback(() => {
    const slotElement = slotElementRef.current ?? document.createElement('div');
    slotElementRef.current = slotElement;
    slotElement.style.display = 'block';
    headerRootRef.current ??= createRoot(slotElement);

    const model = modelRef.current;
    if (model == null) {
      return slotElement;
    }

    headerRootRef.current.render(
      <LocalProjectHeader
        projectName={projectName}
        onAddFile={() => {
          model.add(getUniquePath(model, 'new-file.ts'));
        }}
        onAddFolder={() => {
          model.add(getUniquePath(model, 'new-folder/'));
        }}
      />
    );

    return slotElement;
  }, [modelRef, projectName]);
}

function getProjectNameForMode(
  mode: PathStoreTreesContextMenuTriggerMode
): string {
  switch (mode) {
    case 'button':
      return 'Button Trigger Project';
    case 'right-click':
      return 'Right Click Project';
    default:
      return 'example';
  }
}

function useContextMenuComposition(
  modelRef: { current: PathStoreFileTree | null },
  triggerMode: PathStoreTreesContextMenuTriggerMode
) {
  const contextMenuRenderer = useContextMenuSlotRenderer(modelRef);
  const headerRenderer = useHeaderSlotRenderer(
    modelRef,
    getProjectNameForMode(triggerMode)
  );

  return useMemo(
    () => ({
      contextMenu: {
        enabled: true,
        render: contextMenuRenderer,
        triggerMode,
      },
      header: {
        render: headerRenderer,
      },
    }),
    [contextMenuRenderer, headerRenderer, triggerMode]
  );
}

export function DemoContextMenuClient({
  preloadedDataById,
}: DemoContextMenuClientProps) {
  const [activeMode, setActiveMode] =
    useState<PathStoreTreesContextMenuTriggerMode>('both');
  const modeByName = useMemo(
    () =>
      new Map<PathStoreTreesContextMenuTriggerMode, TriggerModeDemo>(
        TRIGGER_MODE_DEMOS.map((modeDemo) => [modeDemo.mode, modeDemo])
      ),
    []
  );
  const bothModelRef = useRef<PathStoreFileTree | null>(null);
  const rightClickModelRef = useRef<PathStoreFileTree | null>(null);
  const buttonModelRef = useRef<PathStoreFileTree | null>(null);
  const bothComposition = useContextMenuComposition(bothModelRef, 'both');
  const rightClickComposition = useContextMenuComposition(
    rightClickModelRef,
    'right-click'
  );
  const buttonComposition = useContextMenuComposition(buttonModelRef, 'button');
  const activeModeDemo = modeByName.get(activeMode) ?? TRIGGER_MODE_DEMOS[0];
  const { model: bothModel } = useFileTree({
    composition: bothComposition,
    flattenEmptyDirectories: true,
    id: 'path-store-context-menu-demo-both',
    initialExpandedPaths: CONTEXT_MENU_EXPANDED_PATHS,
    paths: sampleFileList,
    search: false,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.contextMenu,
  });
  const { model: rightClickModel } = useFileTree({
    composition: rightClickComposition,
    flattenEmptyDirectories: true,
    id: 'path-store-context-menu-demo-right-click',
    initialExpandedPaths: CONTEXT_MENU_EXPANDED_PATHS,
    paths: sampleFileList,
    search: false,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.contextMenu,
  });
  const { model: buttonModel } = useFileTree({
    composition: buttonComposition,
    flattenEmptyDirectories: true,
    id: 'path-store-context-menu-demo-button',
    initialExpandedPaths: CONTEXT_MENU_EXPANDED_PATHS,
    paths: sampleFileList,
    search: false,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.contextMenu,
  });

  bothModelRef.current = bothModel;
  rightClickModelRef.current = rightClickModel;
  buttonModelRef.current = buttonModel;

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
            Render a custom context menu via{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#composition`}
              className="inline-link"
            >
              <code>composition.contextMenu</code>
            </Link>
            . This demo exposes trigger modes for right-click, trigger button,
            or both, and menu actions for new files, new folders, rename, and
            delete.
          </>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <ButtonGroup
            value={activeMode}
            onValueChange={(value) =>
              setActiveMode(value as PathStoreTreesContextMenuTriggerMode)
            }
          >
            {TRIGGER_MODE_DEMOS.map((modeDemo) => (
              <ButtonGroupItem key={modeDemo.id} value={modeDemo.mode}>
                <code>{modeDemo.title}</code>
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
        <div
          className="overflow-hidden rounded-lg border bg-neutral-900 text-zinc-200"
          style={{ height: `${String(IDE_WINDOW_HEIGHT)}px` }}
        >
          <div className="flex h-8 items-center justify-between border-b border-white/10 px-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
            </div>
          </div>
          <div className="flex h-[calc(100%-2rem)] min-h-0">
            <aside
              className="flex min-h-0 flex-col border-r border-white/10"
              style={{ width: `${String(IDE_EXPLORER_WIDTH_PX)}px` }}
            >
              <FileTree
                key={activeModeDemo.id}
                className="dark h-full min-h-0 overflow-auto p-2"
                model={activeModel}
                preloadedData={preloadedDataById[activeModeDemo.id]}
                style={{
                  ...contextMenuPanelStyle,
                  height: '100%',
                }}
              />
            </aside>
            <section className="flex min-w-0 flex-1 flex-col">
              <div className="flex flex-1 items-center justify-center px-6 text-sm text-zinc-500">
                Editor canvas intentionally empty. Next step: make the explorer
                sidebar resizable.
              </div>
            </section>
          </div>
        </div>
      </div>
    </TreeExampleSection>
  );
}
