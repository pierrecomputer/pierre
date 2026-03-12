/** @jsxImportSource react */
'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  CONTEXT_MENU_SLOT_NAME,
  FILE_TREE_TAG_NAME,
  HEADER_SLOT_NAME,
} from '../constants';
import type {
  FileTreeOptions,
  FileTreeSelectionItem,
  GitStatusEntry,
} from '../FileTree';
import type { ContextMenuItem } from '../types';
import { useFileTreeInstance } from './utils/useFileTreeInstance';

function renderFileTreeChildren(
  header: ReactNode,
  renderContextMenu: ((item: ContextMenuItem) => React.ReactNode) | undefined,
  activeContextMenuItem: ContextMenuItem | null
): ReactNode {
  const headerChild =
    header != null ? <div slot={HEADER_SLOT_NAME}>{header}</div> : null;
  const contextMenuChild =
    renderContextMenu != null && activeContextMenuItem != null ? (
      <div slot={CONTEXT_MENU_SLOT_NAME}>
        {renderContextMenu(activeContextMenuItem)}
      </div>
    ) : null;

  if (headerChild == null && contextMenuChild == null) return null;
  return (
    <>
      {headerChild}
      {contextMenuChild}
    </>
  );
}

export function templateRender(
  children: ReactNode,
  __html: string | undefined
): ReactNode {
  if (typeof window === 'undefined' && __html != null) {
    return (
      <>
        <template
          // @ts-expect-error unclear how to fix this
          shadowrootmode="open"
          dangerouslySetInnerHTML={{ __html }}
        />
        {children}
      </>
    );
  }
  return <>{children}</>;
}

export interface FileTreeProps {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  className?: string;
  style?: React.CSSProperties;
  prerenderedHTML?: string;
  /**
   * If provided, attach/hydrate into an existing <file-tree-container> element
   * (typically rendered by a server component). Slotted context-menu content is
   * rendered into that existing element via a portal.
   */
  containerId?: string;

  // Default (uncontrolled) files
  initialFiles?: string[];

  // Controlled files
  files?: string[];
  onFilesChange?: (files: string[]) => void;

  // Default (uncontrolled) state
  initialExpandedItems?: string[];
  initialSelectedItems?: string[];
  initialSearchQuery?: string | null;

  // Controlled state
  expandedItems?: string[];
  selectedItems?: string[];
  onExpandedItemsChange?: (items: string[]) => void;
  onSelectedItemsChange?: (items: string[]) => void;
  onSelection?: (items: FileTreeSelectionItem[]) => void;

  // Git status
  gitStatus?: GitStatusEntry[];

  // Header
  header?: React.ReactNode;

  // Context menu
  renderContextMenu?: (item: ContextMenuItem) => React.ReactNode;
  onContextMenuOpen?: (item: ContextMenuItem) => void;
  onContextMenuClose?: () => void;
}

export function FileTree({
  options,
  className,
  style,
  prerenderedHTML,
  containerId,
  initialFiles,
  files,
  onFilesChange,
  initialExpandedItems,
  initialSelectedItems,
  initialSearchQuery,
  expandedItems,
  selectedItems,
  onExpandedItemsChange,
  onSelectedItemsChange,
  onSelection,
  gitStatus,
  header,
  renderContextMenu,
  onContextMenuOpen,
  onContextMenuClose,
}: FileTreeProps): React.JSX.Element {
  const [activeContextMenuItem, setActiveContextMenuItem] =
    useState<ContextMenuItem | null>(null);
  const [containerElement, setContainerElement] = useState<HTMLElement | null>(
    null
  );

  const handleContextMenuOpen = useCallback(
    (item: ContextMenuItem) => {
      setActiveContextMenuItem(item);
      onContextMenuOpen?.(item);
    },
    [onContextMenuOpen]
  );

  const handleContextMenuClose = useCallback(() => {
    setActiveContextMenuItem(null);
    onContextMenuClose?.();
  }, [onContextMenuClose]);

  useEffect(() => {
    if (renderContextMenu != null) return;
    setActiveContextMenuItem(null);
  }, [renderContextMenu]);

  const children = renderFileTreeChildren(
    header,
    renderContextMenu,
    activeContextMenuItem
  );
  const { ref } = useFileTreeInstance({
    options,
    initialFiles,
    files,
    onFilesChange,
    initialExpandedItems,
    initialSelectedItems,
    initialSearchQuery,
    expandedItems,
    selectedItems,
    onExpandedItemsChange,
    onSelectedItemsChange,
    onSelection,
    gitStatus,
    onContextMenuOpen:
      renderContextMenu != null ? handleContextMenuOpen : undefined,
    onContextMenuClose:
      renderContextMenu != null ? handleContextMenuClose : undefined,
  });

  useEffect(() => {
    if (containerId == null) return;
    const el = document.getElementById(containerId);
    if (!(el instanceof HTMLElement)) {
      setContainerElement(null);
      return;
    }
    setContainerElement(el);
    const cleanup = ref(el);
    return () => {
      setContainerElement(null);
      if (typeof cleanup === 'function') cleanup();
      else ref(null);
    };
  }, [containerId, ref]);

  if (containerId != null) {
    return containerElement != null && children != null ? (
      <>{createPortal(children, containerElement)}</>
    ) : (
      <></>
    );
  }
  return (
    <FILE_TREE_TAG_NAME
      ref={ref}
      className={className}
      style={style}
      // Declarative shadow DOM: the browser consumes <template shadowrootmode>
      // during document parsing (before React hydrates), so the DOM will always
      // differ from what the server rendered. This is expected and harmless.
      suppressHydrationWarning
    >
      {templateRender(children, prerenderedHTML)}
    </FILE_TREE_TAG_NAME>
  );
}
