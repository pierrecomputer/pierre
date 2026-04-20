'use client';

import type { FileContents } from '@pierre/diffs';
import { File, type FileOptions } from '@pierre/diffs/react';
import { IconFilePlus, IconFolderPlus, IconX } from '@pierre/icons';
import type {
  ContextMenuItem,
  ContextMenuOpenContext,
  FileTree as FileTreeModel,
} from '@pierre/trees';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTreeSelection,
} from '@pierre/trees/react';
import type {
  CSSProperties,
  ReactNode,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const DEFAULT_EXPLORER_WIDTH = 300;
const DEFAULT_MIN_EXPLORER_WIDTH = 180;
const DEFAULT_MAX_EXPLORER_WIDTH = 600;
const DEFAULT_NEW_FILE_NAME = 'untitled';
const DEFAULT_NEW_FOLDER_NAME = 'untitled';

export interface TreeAppTabRenderContext {
  activate: () => void;
  close: () => void;
  isActive: boolean;
  path: string;
}

export interface TreeAppEditorRenderContext {
  file: FileContents | undefined;
  path: string;
  prerenderedHTML: string | undefined;
}

export interface TreeAppContextMenuActions {
  addFile: () => void;
  addFolder: () => void;
  remove: () => void;
  rename: () => void;
}

export interface TreeAppContextMenuRenderContext {
  actions: TreeAppContextMenuActions;
  context: ContextMenuOpenContext;
  item: ContextMenuItem;
}

export interface TreeAppProjectHeaderActions {
  addFile: () => void;
  addFolder: () => void;
}

export interface TreeAppProjectHeaderRenderContext {
  actions: TreeAppProjectHeaderActions;
  projectName: string;
}

export interface TreeAppProps<LAnnotation = unknown> {
  // Tree side: caller owns the model so they keep full control over
  // composition, search, drag/drop, virtualization, etc. The model must be
  // created with `renaming: true` if rename actions are expected to work, and
  // with `composition.contextMenu.triggerMode` set to control how the menu
  // opens.
  model: FileTreeModel;
  preloadedTreeData?: FileTreePreloadedData;
  treeClassName?: string;
  treeStyle?: CSSProperties;

  // Editor side: files keyed by their tree path. Mirrors the
  // preloadedDataById pattern already used by tree demos.
  files?: Readonly<Record<string, FileContents>>;
  prerenderedHTMLByPath?: Readonly<Record<string, string>>;
  fileOptions?: FileOptions<LAnnotation>;

  // SSR-friendly initial state. The first paint can land on a real file.
  initialOpenPaths?: readonly string[];
  initialActivePath?: string | null;

  initialExplorerWidth?: number;
  minExplorerWidth?: number;
  maxExplorerWidth?: number;

  height?: number | string;
  className?: string;
  style?: CSSProperties;

  // Project header (sits above the file tree inside the explorer sidebar).
  // When `projectName` is supplied, TreeApp renders a default header with the
  // name and "new file" / "new folder" buttons. Pass `renderProjectHeader` to
  // fully replace the default markup while still receiving the actions.
  projectName?: string;
  renderProjectHeader?: (
    context: TreeAppProjectHeaderRenderContext
  ) => ReactNode;

  // Context menu rendered through the tree's context menu slot. The model must
  // have `composition.contextMenu.enabled = true` (or pass a custom triggerMode)
  // for the trigger to be wired. By default TreeApp renders a small menu with
  // New file / New folder / Rename / Delete. Override with `renderContextMenu`.
  renderContextMenu?: (context: TreeAppContextMenuRenderContext) => ReactNode;
  // Where the dropdown content portals to. Useful when the host page provides
  // a dedicated dark-mode portal root.
  contextMenuPortalContainer?: HTMLElement | null;

  // Placeholder names used for new file/folder mutations (the user immediately
  // enters rename mode so these are only visible for an instant).
  newFileTemplateName?: string;
  newFolderTemplateName?: string;

  // Other extension slots.
  renderWindowChrome?: () => ReactNode;
  renderTab?: (context: TreeAppTabRenderContext) => ReactNode;
  renderEditor?: (context: TreeAppEditorRenderContext) => ReactNode;
  renderEmpty?: () => ReactNode;
}

// Returns the trailing path segment used as a tab label. Strips a trailing
// slash so directory-style paths still render a sensible name (even though we
// avoid opening directories as tabs in practice).
function basename(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const lastSlash = trimmed.lastIndexOf('/');
  return lastSlash < 0 ? trimmed : trimmed.slice(lastSlash + 1);
}

// Returns the parent directory path for a file or folder path, including the
// trailing slash. Returns the empty string when the path is at the root.
function getParentPath(path: string): string {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex < 0
    ? ''
    : `${normalizedPath.slice(0, lastSlashIndex + 1)}`;
}

// Walks an integer suffix until we find a path that does not collide with an
// existing entry. Preserves a file extension when present so suffix lands as
// `name-1.ext` instead of `name.ext-1`.
function getUniquePath(model: FileTreeModel, basePath: string): string {
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

// Positions the hidden Radix dropdown trigger at the file-tree anchor point so
// the portaled menu aligns correctly for both right-click and trigger-button
// opens.
function getFloatingContextMenuTriggerStyle(
  anchorRect: ContextMenuOpenContext['anchorRect']
): CSSProperties {
  const anchorCenterX = anchorRect.left + anchorRect.width / 2;
  return {
    border: 0,
    height: 1,
    left: `${String(anchorCenterX)}px`,
    opacity: 0,
    padding: 0,
    pointerEvents: 'none',
    position: 'fixed',
    top: `${String(anchorRect.bottom - 1)}px`,
    transform: 'translateX(-50%)',
    width: 1,
  };
}

// Builds the new file/folder mutations TreeApp uses for both the project
// header buttons and the context menu. Both creators add the path then
// immediately enter rename mode so the user names the entry inline rather than
// living with a "untitled" placeholder.
interface UseTreeMutationsOptions {
  model: FileTreeModel;
  newFileTemplateName: string;
  newFolderTemplateName: string;
}

interface TreeMutations {
  addEntry(targetDirectoryPath: string, kind: 'file' | 'folder'): void;
  remove(item: ContextMenuItem): void;
  rename(item: ContextMenuItem): void;
}

function useTreeMutations({
  model,
  newFileTemplateName,
  newFolderTemplateName,
}: UseTreeMutationsOptions): TreeMutations {
  return useMemo<TreeMutations>(
    () => ({
      addEntry(targetDirectoryPath, kind) {
        const template =
          kind === 'folder' ? `${newFolderTemplateName}/` : newFileTemplateName;
        const nextPath = getUniquePath(
          model,
          `${targetDirectoryPath}${template}`
        );
        model.add(nextPath);
        // Drop straight into rename mode so the user types the real name.
        // startRenaming returns false when the model was constructed without
        // `renaming: true`; in that case we still leave the placeholder in.
        model.startRenaming(nextPath);
      },
      remove(item) {
        model.remove(
          item.path,
          item.kind === 'directory' ? { recursive: true } : undefined
        );
      },
      rename(item) {
        model.startRenaming(item.path);
      },
    }),
    [model, newFileTemplateName, newFolderTemplateName]
  );
}

// Owns the explorer sidebar width and exposes a pointer-down handler for the
// drag handle. Uses pointer capture so the drag continues smoothly even if the
// pointer leaves the handle element.
function useExplorerWidth(initial: number, min: number, max: number) {
  const clamp = useCallback(
    (value: number) => Math.max(min, Math.min(max, value)),
    [max, min]
  );
  const [width, setWidth] = useState(() => clamp(initial));
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(
    null
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      dragStateRef.current = { startWidth: width, startX: event.clientX };
    },
    [width]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;
      if (dragState == null) {
        return;
      }
      const delta = event.clientX - dragState.startX;
      setWidth(clamp(dragState.startWidth + delta));
    },
    [clamp]
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current == null) {
      return;
    }
    dragStateRef.current = null;
    const handle = event.currentTarget;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp: endDrag, width };
}

interface UseOpenTabsOptions {
  initialActivePath?: string | null;
  initialOpenPaths?: readonly string[];
  model: FileTreeModel;
}

interface UseOpenTabsResult {
  activePath: string | null;
  activateTab: (path: string) => void;
  closeTab: (path: string) => void;
  openPaths: readonly string[];
}

// Connects tree selection to a tab list. When the user selects a file in the
// tree we ensure that file has a tab and focus it. Directory selections are
// ignored on purpose; opening directories as tabs makes no sense for an IDE.
function useOpenTabs({
  initialActivePath,
  initialOpenPaths,
  model,
}: UseOpenTabsOptions): UseOpenTabsResult {
  const [openPaths, setOpenPaths] = useState<readonly string[]>(() => {
    const seed = initialOpenPaths ?? [];
    if (
      initialActivePath != null &&
      initialActivePath !== '' &&
      !seed.includes(initialActivePath)
    ) {
      return [...seed, initialActivePath];
    }
    return seed;
  });
  const [activePath, setActivePath] = useState<string | null>(
    initialActivePath ?? null
  );
  const selectedPaths = useFileTreeSelection(model);

  // Track which selected paths we have already turned into tabs so a re-render
  // does not re-open a tab the user just closed.
  const lastHandledSelectionRef = useRef<readonly string[]>(selectedPaths);

  useEffect(() => {
    if (selectedPaths === lastHandledSelectionRef.current) {
      return;
    }
    const previous = new Set(lastHandledSelectionRef.current);
    lastHandledSelectionRef.current = selectedPaths;

    // Find the most recently added selection that is a file (not directory).
    // Walking from the end matches the natural notion of "the one the user
    // just clicked".
    for (let index = selectedPaths.length - 1; index >= 0; index -= 1) {
      const candidate = selectedPaths[index];
      if (previous.has(candidate)) {
        continue;
      }
      const item = model.getItem(candidate);
      if (item == null || item.isDirectory()) {
        continue;
      }
      setOpenPaths((current) =>
        current.includes(candidate) ? current : [...current, candidate]
      );
      setActivePath(candidate);
      break;
    }
  }, [model, selectedPaths]);

  const closeTab = useCallback((path: string) => {
    setOpenPaths((current) => {
      const nextOpen = current.filter((entry) => entry !== path);
      setActivePath((currentActive) => {
        if (currentActive !== path) {
          return currentActive;
        }
        if (nextOpen.length === 0) {
          return null;
        }
        const closedIndex = current.indexOf(path);
        const fallbackIndex = Math.min(closedIndex, nextOpen.length - 1);
        return nextOpen[fallbackIndex] ?? null;
      });
      return nextOpen;
    });
  }, []);

  const activateTab = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  return { activePath, activateTab, closeTab, openPaths };
}

function DefaultWindowChrome(): React.JSX.Element {
  return (
    <div className="flex h-8 items-center justify-between border-b border-white/10 px-3">
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
      </div>
    </div>
  );
}

function DefaultEmpty(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-sm text-zinc-500">
      Select a file from the explorer.
    </div>
  );
}

function DefaultProjectHeader({
  actions,
  projectName,
}: TreeAppProjectHeaderRenderContext): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0 truncate text-sm font-medium text-neutral-200">
        {projectName}/
      </div>
      {/* Buttons live inside the explorer hover group (set on the <aside> in
          TreeApp) so they only appear when the user is interacting with the
          tree. focus-within keeps them visible for keyboard navigation. */}
      <div className="flex items-center gap-3 opacity-0 transition-opacity duration-150 group-hover/tree-app-explorer:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          title="New file"
          onClick={actions.addFile}
          className="h-4 w-4 text-neutral-400 hover:text-neutral-100"
        >
          <IconFilePlus aria-hidden="true" />
        </button>
        <button
          type="button"
          title="New folder"
          onClick={actions.addFolder}
          className="h-4 w-4 text-neutral-400 hover:text-neutral-100"
        >
          <IconFolderPlus aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function DefaultContextMenu({
  actions,
  context,
  portalContainer,
}: {
  actions: TreeAppContextMenuActions;
  context: ContextMenuOpenContext;
  portalContainer: HTMLElement | null | undefined;
}): React.JSX.Element {
  const closeAfter = (action: () => void) => {
    action();
    context.close();
  };

  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          context.close();
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          style={getFloatingContextMenuTriggerStyle(context.anchorRect)}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        container={portalContainer}
        data-file-tree-context-menu-root="true"
        align="center"
        side="bottom"
        sideOffset={4}
        className="min-w-[180px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          context.restoreFocus();
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            // Keep the menu open while we transition into rename mode so the
            // restoreFocus path doesn't pull focus away from the new input.
            context.close({ restoreFocus: false });
            actions.addFile();
          }}
        >
          New file
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            context.close({ restoreFocus: false });
            actions.addFolder();
          }}
        >
          New folder
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            context.close({ restoreFocus: false });
            actions.rename();
          }}
        >
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="danger"
          onSelect={() => {
            closeAfter(actions.remove);
          }}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface DefaultTabProps extends TreeAppTabRenderContext {}

function DefaultTab({
  activate,
  close,
  isActive,
  path,
}: DefaultTabProps): React.JSX.Element {
  const label = basename(path);
  return (
    <div
      className={[
        'group flex h-8 max-w-[200px] items-center gap-1.5 border-r border-white/10 pr-1 pl-3 text-xs',
        isActive
          ? 'bg-neutral-900 text-zinc-100'
          : 'bg-neutral-800/60 text-zinc-400 hover:text-zinc-200',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={activate}
        title={path}
        className="min-w-0 flex-1 truncate text-left"
      >
        {label}
      </button>
      <button
        type="button"
        onClick={close}
        title="Close tab"
        aria-label={`Close ${label}`}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-zinc-100 focus:opacity-100"
      >
        <IconX aria-hidden="true" className="h-3 w-3" />
      </button>
    </div>
  );
}

export function TreeApp<LAnnotation = unknown>({
  className,
  contextMenuPortalContainer,
  files,
  fileOptions,
  height = '100%',
  initialActivePath,
  initialExplorerWidth = DEFAULT_EXPLORER_WIDTH,
  initialOpenPaths,
  maxExplorerWidth = DEFAULT_MAX_EXPLORER_WIDTH,
  minExplorerWidth = DEFAULT_MIN_EXPLORER_WIDTH,
  model,
  newFileTemplateName = DEFAULT_NEW_FILE_NAME,
  newFolderTemplateName = DEFAULT_NEW_FOLDER_NAME,
  preloadedTreeData,
  prerenderedHTMLByPath,
  projectName,
  renderContextMenu,
  renderEditor,
  renderEmpty,
  renderProjectHeader,
  renderTab,
  renderWindowChrome,
  style,
  treeClassName,
  treeStyle,
}: TreeAppProps<LAnnotation>): React.JSX.Element {
  const explorer = useExplorerWidth(
    initialExplorerWidth,
    minExplorerWidth,
    maxExplorerWidth
  );
  const { activePath, activateTab, closeTab, openPaths } = useOpenTabs({
    initialActivePath,
    initialOpenPaths,
    model,
  });
  const mutations = useTreeMutations({
    model,
    newFileTemplateName,
    newFolderTemplateName,
  });

  const containerStyle = useMemo<CSSProperties>(
    () => ({ height, ...style }),
    [height, style]
  );

  const sidebarStyle = useMemo<CSSProperties>(
    () => ({ width: `${String(explorer.width)}px` }),
    [explorer.width]
  );

  const treeHostStyle = useMemo<CSSProperties>(
    () => ({ ...treeStyle, height: '100%' }),
    [treeStyle]
  );

  const headerNode = useMemo<ReactNode>(() => {
    if (projectName == null && renderProjectHeader == null) {
      return null;
    }
    const headerContext: TreeAppProjectHeaderRenderContext = {
      actions: {
        addFile: () => {
          mutations.addEntry('', 'file');
        },
        addFolder: () => {
          mutations.addEntry('', 'folder');
        },
      },
      projectName: projectName ?? '',
    };
    if (renderProjectHeader != null) {
      return renderProjectHeader(headerContext);
    }
    return <DefaultProjectHeader {...headerContext} />;
  }, [mutations, projectName, renderProjectHeader]);

  // Builds the per-row context menu actions from a clicked item. Adding new
  // entries lands inside the directory itself when the click target is a
  // folder, otherwise next to the file.
  const buildContextMenuActions = useCallback(
    (item: ContextMenuItem): TreeAppContextMenuActions => {
      const baseDirectoryPath =
        item.kind === 'directory' ? item.path : getParentPath(item.path);
      return {
        addFile: () => {
          mutations.addEntry(baseDirectoryPath, 'file');
        },
        addFolder: () => {
          mutations.addEntry(baseDirectoryPath, 'folder');
        },
        remove: () => {
          mutations.remove(item);
        },
        rename: () => {
          mutations.rename(item);
        },
      };
    },
    [mutations]
  );

  const renderFileTreeContextMenu = useCallback(
    (item: ContextMenuItem, context: ContextMenuOpenContext): ReactNode => {
      const actions = buildContextMenuActions(item);
      if (renderContextMenu != null) {
        return renderContextMenu({ actions, context, item });
      }
      return (
        <DefaultContextMenu
          actions={actions}
          context={context}
          portalContainer={contextMenuPortalContainer}
        />
      );
    },
    [buildContextMenuActions, contextMenuPortalContainer, renderContextMenu]
  );

  const editor = useMemo(() => {
    if (activePath == null) {
      return renderEmpty != null ? renderEmpty() : <DefaultEmpty />;
    }
    const file = files?.[activePath];
    const prerenderedHTML = prerenderedHTMLByPath?.[activePath];
    if (renderEditor != null) {
      return renderEditor({ file, path: activePath, prerenderedHTML });
    }
    if (file == null) {
      return renderEmpty != null ? renderEmpty() : <DefaultEmpty />;
    }
    return (
      <File
        key={activePath}
        file={file}
        options={fileOptions}
        prerenderedHTML={prerenderedHTML}
        className="h-full min-h-0 overflow-auto"
      />
    );
  }, [
    activePath,
    fileOptions,
    files,
    prerenderedHTMLByPath,
    renderEditor,
    renderEmpty,
  ]);

  return (
    <div
      className={[
        'overflow-hidden rounded-lg border bg-neutral-900 text-zinc-200',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={containerStyle}
    >
      {renderWindowChrome != null ? (
        renderWindowChrome()
      ) : (
        <DefaultWindowChrome />
      )}
      <div className="flex h-[calc(100%-2rem)] min-h-0">
        <aside
          className="group/tree-app-explorer flex min-h-0 shrink-0 flex-col"
          style={sidebarStyle}
        >
          <FileTree
            className={treeClassName}
            header={headerNode}
            model={model}
            preloadedData={preloadedTreeData}
            renderContextMenu={renderFileTreeContextMenu}
            style={treeHostStyle}
          />
        </aside>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize explorer"
          onPointerDown={explorer.onPointerDown}
          onPointerMove={explorer.onPointerMove}
          onPointerUp={explorer.onPointerUp}
          onPointerCancel={explorer.onPointerUp}
          className="relative w-px shrink-0 cursor-col-resize bg-white/10 after:absolute after:inset-y-0 after:-left-1 after:w-2 after:content-['']"
        />
        <section className="flex min-w-0 flex-1 flex-col">
          {openPaths.length > 0 ? (
            <div className="flex h-8 min-h-8 items-stretch overflow-x-auto border-b border-white/10 bg-neutral-950/40">
              {openPaths.map((path) => {
                const tabContext: TreeAppTabRenderContext = {
                  activate: () => {
                    activateTab(path);
                  },
                  close: () => {
                    closeTab(path);
                  },
                  isActive: path === activePath,
                  path,
                };
                return (
                  <div key={path} className="flex">
                    {renderTab != null ? (
                      renderTab(tabContext)
                    ) : (
                      <DefaultTab {...tabContext} />
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col">{editor}</div>
        </section>
      </div>
    </div>
  );
}
