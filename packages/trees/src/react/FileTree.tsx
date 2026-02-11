/** @jsxImportSource react */
'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { FILE_TREE_TAG_NAME } from '../constants';
import type { FileTreeOptions, FileTreeSelectionItem } from '../FileTree';
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
  options: FileTreeOptions;
  className?: string;
  style?: React.CSSProperties;
  prerenderedHTML?: string;
  /**
   * If provided, attach/hydrate into an existing <file-tree-container> element
   * (typically rendered by a server component). In this mode, this component
   * renders nothing.
   */
  containerId?: string;

  // Default (uncontrolled) state
  defaultExpandedItems?: string[];
  defaultSelectedItems?: string[];

  // Controlled state
  expandedItems?: string[];
  selectedItems?: string[];
  onExpandedItemsChange?: (items: string[]) => void;
  onSelectedItemsChange?: (items: string[]) => void;
  onSelection?: (items: FileTreeSelectionItem[]) => void;
}

export function FileTree({
  options,
  className,
  style,
  prerenderedHTML,
  containerId,
  defaultExpandedItems,
  defaultSelectedItems,
  expandedItems,
  selectedItems,
  onExpandedItemsChange,
  onSelectedItemsChange,
  onSelection,
}: FileTreeProps): React.JSX.Element {
  const children = renderFileTreeChildren();
  const { ref } = useFileTreeInstance({
    options,
    defaultExpandedItems,
    defaultSelectedItems,
    expandedItems,
    selectedItems,
    onExpandedItemsChange,
    onSelectedItemsChange,
    onSelection,
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
    <FILE_TREE_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </FILE_TREE_TAG_NAME>
  );
}
