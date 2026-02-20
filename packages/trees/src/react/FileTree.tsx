/** @jsxImportSource react */
'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { FILE_TREE_TAG_NAME } from '../constants';
import type {
  FileTreeOptions,
  FileTreeSelectionItem,
  GitStatusEntry,
} from '../FileTree';
import { useFileTreeInstance } from './utils/useFileTreeInstance';

function renderFileTreeChildren(): ReactNode {
  return <>{/* <div slot="fake-slot">METADATA</div> */}</>;
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
   * (typically rendered by a server component). In this mode, this component
   * renders nothing.
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

  // Controlled state
  expandedItems?: string[];
  selectedItems?: string[];
  onExpandedItemsChange?: (items: string[]) => void;
  onSelectedItemsChange?: (items: string[]) => void;
  onSelection?: (items: FileTreeSelectionItem[]) => void;

  // Git status
  gitStatus?: GitStatusEntry[];
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
  expandedItems,
  selectedItems,
  onExpandedItemsChange,
  onSelectedItemsChange,
  onSelection,
  gitStatus,
}: FileTreeProps): React.JSX.Element {
  const children = renderFileTreeChildren();
  const { ref } = useFileTreeInstance({
    options,
    initialFiles,
    files,
    onFilesChange,
    initialExpandedItems,
    initialSelectedItems,
    expandedItems,
    selectedItems,
    onExpandedItemsChange,
    onSelectedItemsChange,
    onSelection,
    gitStatus,
  });

  useEffect(() => {
    if (containerId == null) return;
    const el = document.getElementById(containerId);
    if (!(el instanceof HTMLElement)) {
      return;
    }
    const cleanup = ref(el);
    return () => {
      if (typeof cleanup === 'function') cleanup();
      else ref(null);
    };
  }, [containerId, ref]);

  if (containerId != null) {
    return <></>;
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
