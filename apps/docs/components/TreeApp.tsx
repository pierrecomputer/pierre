'use client';

import type { FileContents } from '@pierre/diffs';
import { File, type FileOptions } from '@pierre/diffs/react';
import { IconX } from '@pierre/icons';
import type { FileTree as FileTreeModel } from '@pierre/trees';
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

const DEFAULT_EXPLORER_WIDTH = 300;
const DEFAULT_MIN_EXPLORER_WIDTH = 180;
const DEFAULT_MAX_EXPLORER_WIDTH = 600;

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

export interface TreeAppProps<LAnnotation = unknown> {
  // Tree side: caller owns the model so they keep full control over
  // composition, search, drag/drop, virtualization, etc.
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

  // Extension slots. All optional; sensible defaults are provided.
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
  files,
  fileOptions,
  height = '100%',
  initialActivePath,
  initialExplorerWidth = DEFAULT_EXPLORER_WIDTH,
  initialOpenPaths,
  maxExplorerWidth = DEFAULT_MAX_EXPLORER_WIDTH,
  minExplorerWidth = DEFAULT_MIN_EXPLORER_WIDTH,
  model,
  preloadedTreeData,
  prerenderedHTMLByPath,
  renderEditor,
  renderEmpty,
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
        <aside className="flex min-h-0 shrink-0 flex-col" style={sidebarStyle}>
          <FileTree
            className={treeClassName}
            model={model}
            preloadedData={preloadedTreeData}
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
