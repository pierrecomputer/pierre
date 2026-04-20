'use client';

import type { FileContents } from '@pierre/diffs';
import { File, type FileOptions } from '@pierre/diffs/react';
import { IconFilePlus, IconFolderPlus, IconSearch, IconX } from '@pierre/icons';
import type {
  ContextMenuItem,
  ContextMenuOpenContext,
  FileTreeIcons,
  FileTree as FileTreeModel,
} from '@pierre/trees';
import {
  createFileTreeIconResolver,
  getBuiltInFileIconColor,
  getBuiltInSpriteSheet,
} from '@pierre/trees';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTreeSearch,
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
  toggleSearch: () => void;
}

export interface TreeAppProjectHeaderRenderContext {
  actions: TreeAppProjectHeaderActions;
  projectName: string;
  // True when the caller opted into the tree's built-in search (search: true on
  // the model) AND passed `searchEnabled` on TreeApp. Custom project headers
  // use this to decide whether to render a search toggle at all.
  isSearchEnabled: boolean;
  // Reactive open/closed state for the built-in search input. Used to render
  // an "active" visual on the toggle button.
  isSearchOpen: boolean;
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
  // Set to true when the underlying FileTree model was constructed with
  // `search: true`. Enables the search toggle in the default project header
  // and lets custom headers know they can show a toggle of their own.
  searchEnabled?: boolean;

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
  showTabs?: boolean;
  renderEditor?: (context: TreeAppEditorRenderContext) => ReactNode;
  renderEmpty?: () => ReactNode;
  tabIcons?: FileTreeIcons;
}

interface TreeAppResolvedTabIcon {
  height?: number;
  name: string;
  token?: string;
  viewBox?: string;
  width?: number;
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

// Remaps one path after a tree move so open tabs and editor state keep
// following the same file or directory even when its parent folder changes.
function remapMovedPath(
  path: string,
  fromPath: string,
  toPath: string
): string {
  if (path === fromPath) {
    return toPath;
  }

  const descendantPrefix = `${fromPath}/`;
  if (!path.startsWith(descendantPrefix)) {
    return path;
  }

  return `${toPath}${path.slice(fromPath.length)}`;
}

function remapMovedPaths(
  paths: readonly string[],
  fromPath: string,
  toPath: string
): readonly string[] {
  const seen = new Set<string>();
  const remapped: string[] = [];
  for (const path of paths) {
    const nextPath = remapMovedPath(path, fromPath, toPath);
    if (seen.has(nextPath)) {
      continue;
    }
    seen.add(nextPath);
    remapped.push(nextPath);
  }
  return remapped;
}

// Walks an integer suffix until we find a path that does not collide with an
// existing entry. Preserves a file extension when present so suffix lands as
// `name-1.ext` instead of `name.ext-1`. Collisions are checked against both
// the file (no trailing slash) and folder (trailing slash) forms so creating a
// folder named `untitled` does not silently overwrite an existing file of the
// same name (and vice versa).
function getUniquePath(model: FileTreeModel, basePath: string): string {
  const hasCollision = (candidate: string): boolean => {
    if (model.getItem(candidate) != null) return true;
    const alternate = candidate.endsWith('/')
      ? candidate.slice(0, -1)
      : `${candidate}/`;
    return model.getItem(alternate) != null;
  };

  let suffix = 0;
  let candidate = basePath;
  while (hasCollision(candidate)) {
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

function hasCustomIconOverrides(icons: FileTreeIcons): boolean {
  return (
    typeof icons !== 'string' &&
    (icons.spriteSheet != null ||
      icons.remap != null ||
      icons.byFileName != null ||
      icons.byFileExtension != null ||
      icons.byFileNameContains != null)
  );
}

// Builds the icon sprite markup the tab strip needs outside the tree shadow
// DOM. When callers pass custom tab icon rules, we include both the built-in
// sprite set (when enabled) and the caller's custom sprite symbols.
function getTabIconSpriteMarkup(icons?: FileTreeIcons): string {
  if (icons == null) {
    return getBuiltInSpriteSheet('complete');
  }

  if (typeof icons === 'string') {
    return getBuiltInSpriteSheet(icons);
  }

  const set =
    icons.set ?? (hasCustomIconOverrides(icons) ? 'none' : 'complete');
  const builtInSpriteSheet = set === 'none' ? '' : getBuiltInSpriteSheet(set);
  const customSpriteSheet = icons.spriteSheet?.trim() ?? '';
  return `${builtInSpriteSheet}${customSpriteSheet}`;
}

function areColoredTabIconsEnabled(icons?: FileTreeIcons): boolean {
  if (icons == null || typeof icons === 'string') {
    return true;
  }

  return icons.colored ?? true;
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
        model.startRenaming(nextPath, {
          removeIfCanceled: true,
        });
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

  const closeTab = useCallback(
    (path: string) => {
      if (activePath === path) {
        const item = model.getItem(path);
        if (item?.isSelected() === true) {
          item.deselect();
        }
      }

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
    },
    [activePath, model]
  );

  const activateTab = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  useEffect(() => {
    if (activePath == null) {
      return;
    }

    const activeItem = model.getItem(activePath);
    if (activeItem == null) {
      return;
    }

    for (const selectedPath of model.getSelectedPaths()) {
      if (selectedPath === activePath) {
        continue;
      }
      model.getItem(selectedPath)?.deselect();
    }

    if (!activeItem.isSelected()) {
      activeItem.select();
    }
  }, [activePath, model]);

  useEffect(
    () =>
      model.onMutation('*', (event) => {
        const moveEvents =
          event.operation === 'move'
            ? [event]
            : event.operation === 'batch'
              ? event.events.filter((entry) => entry.operation === 'move')
              : [];
        if (moveEvents.length === 0) {
          return;
        }

        setOpenPaths((current) => {
          let nextPaths = current;
          for (const moveEvent of moveEvents) {
            nextPaths = remapMovedPaths(
              nextPaths,
              moveEvent.from,
              moveEvent.to
            );
          }
          return nextPaths;
        });
        setActivePath((current) => {
          if (current == null) {
            return current;
          }

          let nextPath = current;
          for (const moveEvent of moveEvents) {
            nextPath = remapMovedPath(nextPath, moveEvent.from, moveEvent.to);
          }
          return nextPath;
        });
      }),
    [model]
  );

  return { activePath, activateTab, closeTab, openPaths };
}

function WindowControls(): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-3 w-3 rounded-full bg-[#ff5f56]" />
      <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
      <span className="h-3 w-3 rounded-full bg-[#27c93f]" />
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
  isSearchEnabled,
  isSearchOpen,
  projectName,
}: TreeAppProjectHeaderRenderContext): React.JSX.Element {
  return (
    <div className="mb-2 flex h-10 items-center justify-between gap-2 px-3 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <WindowControls />
        <div className="min-w-0 truncate text-xs font-medium text-neutral-200">
          {projectName}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isSearchEnabled ? (
          // Search button sits outside the hover-only opacity group so that
          // when search is active the user always sees the toggle that closes
          // it. When search is closed we still only reveal it on hover, to
          // match the new-file/new-folder affordance.
          <button
            type="button"
            title={isSearchOpen ? 'Clear and close search' : 'Search files'}
            aria-pressed={isSearchOpen}
            // preventDefault on mousedown keeps focus on the search input so
            // its onBlur handler doesn't race our click and auto-close+reopen
            // the search. Without this, clicking the toggle while the input
            // is focused would blur -> closeSearch() -> click sees isOpen=
            // false -> reopen.
            onMouseDown={(event) => {
              if (isSearchOpen) {
                event.preventDefault();
              }
            }}
            onClick={actions.toggleSearch}
            className={[
              'h-4 w-4 transition-opacity duration-150 cursor-pointer',
              isSearchOpen
                ? 'text-neutral-100 opacity-100'
                : 'text-neutral-400 opacity-25 group-hover/tree-app-explorer:opacity-100 focus-visible:opacity-100 hover:text-neutral-100',
            ].join(' ')}
          >
            <IconSearch aria-hidden="true" className="h-[14px] w-[14px]" />
          </button>
        ) : null}
        {/* New file/folder buttons live inside the explorer hover group (set on
            the <aside> in TreeApp) so they only appear when the user is
            interacting with the tree. focus-within keeps them visible for
            keyboard navigation. */}
        <div className="flex items-center gap-2 opacity-25 transition-opacity duration-150 group-hover/tree-app-explorer:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            title="New file"
            onClick={actions.addFile}
            className="h-4 w-4 cursor-pointer text-neutral-400 hover:text-neutral-100"
          >
            <IconFilePlus aria-hidden="true" />
          </button>
          <button
            type="button"
            title="New folder"
            onClick={actions.addFolder}
            className="h-4 w-4 cursor-pointer text-neutral-400 hover:text-neutral-100"
          >
            <IconFolderPlus aria-hidden="true" />
          </button>
        </div>
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

function TreeAppTabIcon({
  colored,
  icon,
}: {
  colored: boolean;
  icon: TreeAppResolvedTabIcon;
}): React.JSX.Element {
  const href = `#${icon.name.replace(/^#/, '')}`;
  const viewBox =
    icon.viewBox ??
    `0 0 ${String(icon.width ?? 16)} ${String(icon.height ?? 16)}`;
  const builtInColor =
    icon.token != null ? getBuiltInFileIconColor(icon.token) : undefined;
  const colorStyle =
    colored && icon.token != null
      ? {
          color:
            builtInColor ??
            'var(--trees-fg-muted, light-dark(#84848a, #adadb1))',
        }
      : undefined;

  return (
    <svg
      aria-hidden="true"
      data-icon-name={icon.name}
      data-icon-token={icon.token}
      viewBox={viewBox}
      width={icon.width ?? 16}
      height={icon.height ?? 16}
      className="h-4 w-4 shrink-0"
      style={colorStyle}
    >
      <use href={href} />
    </svg>
  );
}

function DefaultTab({
  activate,
  close,
  icon,
  iconsColored,
  isActive,
  path,
}: DefaultTabProps & {
  icon: TreeAppResolvedTabIcon;
  iconsColored: boolean;
}): React.JSX.Element {
  const label = basename(path);
  return (
    <div
      className={[
        'group relative isolate flex h-7 max-w-[200px] items-center overflow-hidden rounded-sm text-xs font-medium transition-colors',
        isActive
          ? 'bg-transparent text-zinc-100 group-hover/tabbar:bg-neutral-900'
          : 'bg-transparent text-zinc-400 group-hover/tabbar:bg-neutral-900/30 group-hover/tabbar:hover:bg-neutral-800/60 group-hover/tabbar:hover:text-zinc-200',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={activate}
        title={path}
        className="relative z-0 flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pr-3 pl-2 text-left"
      >
        <TreeAppTabIcon colored={iconsColored} icon={icon} />
        <span className="block truncate">{label}</span>
      </button>
      <div
        aria-hidden="true"
        className={[
          'pointer-events-none absolute top-0 right-0 bottom-0 z-10 w-12 opacity-0 transition-opacity group-hover:opacity-100',
          isActive
            ? 'bg-gradient-to-l from-neutral-900 via-neutral-900 to-transparent'
            : 'bg-gradient-to-l from-neutral-900 via-neutral-900 to-transparent',
        ].join(' ')}
      />
      <button
        type="button"
        onClick={close}
        title="Close tab"
        aria-label={`Close ${label}`}
        className="absolute top-1/2 right-1 z-20 flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 hover:text-zinc-100 focus:opacity-100"
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
  searchEnabled = false,
  showTabs = true,
  style,
  tabIcons,
  treeClassName,
  treeStyle,
}: TreeAppProps<LAnnotation>): React.JSX.Element {
  const treeStyleRecord = treeStyle as
    | Record<string, string | number>
    | undefined;
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
  const search = useFileTreeSearch(model);
  const toggleSearch = useCallback(() => {
    if (search.isOpen) {
      search.close();
      return;
    }
    search.open();
  }, [search]);

  const treeSurfaceColor = useMemo(() => {
    const explicitTreeBackground =
      treeStyleRecord?.['--trees-bg-override'] ??
      treeStyleRecord?.['--trees-theme-sidebar-bg'];
    return typeof explicitTreeBackground === 'string'
      ? explicitTreeBackground
      : '#141415';
  }, [treeStyleRecord]);

  const treeCssVariables = useMemo<CSSProperties>(() => {
    if (treeStyleRecord == null) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(treeStyleRecord).filter(([key]) =>
        key.startsWith('--trees-')
      )
    ) as CSSProperties;
  }, [treeStyleRecord]);

  const containerStyle = useMemo<CSSProperties>(
    () => ({
      ...treeCssVariables,
      '--tree-app-tree-surface': treeSurfaceColor,
      height,
      ...style,
    }),
    [height, style, treeCssVariables, treeSurfaceColor]
  );

  const sidebarStyle = useMemo<CSSProperties>(
    () => ({ width: `${String(explorer.width)}px` }),
    [explorer.width]
  );

  const treeHostStyle = useMemo<CSSProperties>(
    () => ({
      ...treeStyle,
      height: '100%',
      borderRadius: '8px',
      border: '1px solid rgb(255 255 255 / 0.05)',
    }),
    [treeStyle]
  );
  const windowChromeNode = renderWindowChrome?.();
  const effectiveTabIcons = tabIcons ?? 'complete';
  const tabIconSpriteMarkup = useMemo(
    () => getTabIconSpriteMarkup(effectiveTabIcons),
    [effectiveTabIcons]
  );
  const resolveTabIcon = useMemo(
    () => createFileTreeIconResolver(effectiveTabIcons).resolveIcon,
    [effectiveTabIcons]
  );
  const tabIconsColored = useMemo(
    () => areColoredTabIconsEnabled(effectiveTabIcons),
    [effectiveTabIcons]
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
        toggleSearch,
      },
      isSearchEnabled: searchEnabled,
      isSearchOpen: search.isOpen,
      projectName: projectName ?? '',
    };
    if (renderProjectHeader != null) {
      return renderProjectHeader(headerContext);
    }
    return <DefaultProjectHeader {...headerContext} />;
  }, [
    mutations,
    projectName,
    renderProjectHeader,
    search.isOpen,
    searchEnabled,
    toggleSearch,
  ]);

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
        'flex flex-col overflow-hidden rounded-xl border bg-[#070707] text-zinc-200 shadow-lg p-1.5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={containerStyle}
    >
      <div
        aria-hidden="true"
        className="absolute h-0 w-0 overflow-hidden"
        dangerouslySetInnerHTML={{ __html: tabIconSpriteMarkup }}
      />
      {windowChromeNode != null ? (
        <div className="shrink-0">{windowChromeNode}</div>
      ) : null}
      <div className="flex min-h-0 flex-1">
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
          className="relative w-px shrink-0 cursor-col-resize bg-white/0 after:absolute after:inset-y-0 after:-left-1 after:w-2 after:content-['']"
        />
        <section className="flex min-w-0 flex-1 flex-col">
          {showTabs && openPaths.length > 0 ? (
            <div
              className="group/tabbar flex h-10 items-center gap-1 overflow-x-auto px-2"
              style={{ backgroundColor: 'light-dark(#fff, #070707)' }}
            >
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
                const tabIcon = resolveTabIcon(
                  'file-tree-icon-file',
                  path
                ) as TreeAppResolvedTabIcon;
                return (
                  <div key={path} className="flex">
                    {renderTab != null ? (
                      renderTab(tabContext)
                    ) : (
                      <DefaultTab
                        {...tabContext}
                        icon={tabIcon}
                        iconsColored={tabIconsColored}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          <div
            className="flex min-h-0 flex-1 flex-col"
            style={{ backgroundColor: '#070707' }}
          >
            {editor}
          </div>
        </section>
      </div>
    </div>
  );
}
