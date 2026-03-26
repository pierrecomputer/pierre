import { useCallback, useRef } from 'preact/hooks';

import type { TreeInstance } from '../../core/types/core';
import type { FileTreeNode } from '../../types';

export interface UseFlattenedDropTargetResult {
  flattenedDropSubfolderIdRef: { current: string | null };
  detectFlattenedSubfolder: (e: DragEvent) => void;
  clearFlattenedSubfolder: () => void;
  detectFlattenedSubfolderFromPoint: (clientX: number, clientY: number) => void;
}

/**
 * Manages highlight state when dragging over sub-items inside flattened
 * directory chains. Tracks which sub-folder the cursor is over so the
 * drop handler can resolve the correct target.
 *
 * Accepts a ref to the tree instance rather than the instance directly
 * because the hook must be called before useTree (its callbacks feed into
 * the tree config), while tree is only available after useTree returns.
 * The ref is populated by Root immediately after useTree.
 */
export function useFlattenedDropTarget(treeRef: {
  current: TreeInstance<FileTreeNode> | null;
}): UseFlattenedDropTargetResult {
  'use no memo';
  const flattenedDropSubfolderIdRef = useRef<string | null>(null);
  const flattenedHighlightRef = useRef<HTMLElement | null>(null);

  const detectFlattenedSubfolder = useCallback((e: DragEvent) => {
    let el = e.target as HTMLElement | null;
    if (el != null && el.nodeType === Node.TEXT_NODE) {
      el = el.parentElement;
    }
    const span = el?.closest?.(
      '[data-item-flattened-subitem]'
    ) as HTMLElement | null;
    const id = span?.getAttribute('data-item-flattened-subitem') ?? null;

    if (id === flattenedDropSubfolderIdRef.current) return;

    if (flattenedHighlightRef.current != null) {
      flattenedHighlightRef.current.removeAttribute(
        'data-item-flattened-subitem-drag-target'
      );
    }

    if (span != null && id != null) {
      span.setAttribute('data-item-flattened-subitem-drag-target', 'true');
      flattenedHighlightRef.current = span;
      flattenedDropSubfolderIdRef.current = id;
    } else {
      flattenedHighlightRef.current = null;
      flattenedDropSubfolderIdRef.current = null;
    }
  }, []);

  const clearFlattenedSubfolder = useCallback(() => {
    if (flattenedHighlightRef.current != null) {
      flattenedHighlightRef.current.removeAttribute(
        'data-item-flattened-subitem-drag-target'
      );
    }
    flattenedHighlightRef.current = null;
    flattenedDropSubfolderIdRef.current = null;
  }, []);

  const detectFlattenedSubfolderFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const treeEl = treeRef.current?.getElement();
      const root = treeEl?.getRootNode() as Document | ShadowRoot;
      let el = (root ?? document).elementFromPoint(
        clientX,
        clientY
      ) as HTMLElement | null;
      if (el != null && el.nodeType === Node.TEXT_NODE) {
        el = el.parentElement;
      }
      const span = el?.closest?.(
        '[data-item-flattened-subitem]'
      ) as HTMLElement | null;
      const id = span?.getAttribute('data-item-flattened-subitem') ?? null;

      if (id === flattenedDropSubfolderIdRef.current) return;

      if (flattenedHighlightRef.current != null) {
        flattenedHighlightRef.current.removeAttribute(
          'data-item-flattened-subitem-drag-target'
        );
      }

      if (span != null && id != null) {
        span.setAttribute('data-item-flattened-subitem-drag-target', 'true');
        flattenedHighlightRef.current = span;
        flattenedDropSubfolderIdRef.current = id;
      } else {
        flattenedHighlightRef.current = null;
        flattenedDropSubfolderIdRef.current = null;
      }
    },
    // treeRef is a stable ref object; treeRef.current is populated after useTree
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return {
    flattenedDropSubfolderIdRef,
    detectFlattenedSubfolder,
    clearFlattenedSubfolder,
    detectFlattenedSubfolderFromPoint,
  };
}
