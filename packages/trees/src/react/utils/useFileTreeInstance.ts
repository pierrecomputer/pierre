import { useCallback, useEffect, useRef } from 'react';

import {
  FileTree,
  type FileTreeOptions,
  type FileTreeSelectionItem,
  type FileTreeStateConfig,
} from '../../FileTree';

interface UseFileTreeInstanceProps {
  options: Omit<FileTreeOptions, 'initialFiles'>;

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
}

interface UseFileTreeInstanceReturn {
  ref(node: HTMLElement | null): void | (() => void);
}

export function useFileTreeInstance({
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
}: UseFileTreeInstanceProps): UseFileTreeInstanceReturn {
  const containerRef = useRef<HTMLElement | null>(null);
  const instanceRef = useRef<FileTree | null>(null);

  // Keep a ref to the latest state-related props so the ref callback can read
  // them at creation time without including them as useMemo deps.
  const statePropsRef = useRef<
    FileTreeStateConfig & { initialFiles?: string[] }
  >({
    files,
    initialFiles,
    onFilesChange,
    expandedItems,
    selectedItems,
    onExpandedItemsChange,
    onSelectedItemsChange,
    onSelection,
    initialExpandedItems,
    initialSelectedItems,
  });
  statePropsRef.current = {
    files,
    initialFiles,
    onFilesChange,
    expandedItems,
    selectedItems,
    onExpandedItemsChange,
    onSelectedItemsChange,
    onSelection,
    initialExpandedItems,
    initialSelectedItems,
  };

  // Ref callback that handles mount/unmount and re-runs when options change.
  // By including options in the dependency array, the callback identity changes
  // when structural options change, causing React to call cleanup then re-invoke with the
  // same DOM node - allowing us to detect and handle options changes.
  //
  // React 19: Return cleanup function, called when ref changes or element unmounts.
  const ref = useCallback(
    (fileTreeContainer: HTMLElement | null) => {
      if (fileTreeContainer == null) {
        instanceRef.current?.cleanUp();
        instanceRef.current = null;
        containerRef.current = null;
        return;
      }

      const getExistingFileTreeId = (): string | undefined => {
        const children = Array.from(
          fileTreeContainer.shadowRoot?.children ?? []
        );
        const fileTreeElement = children.find(
          (child: Element): child is HTMLElement =>
            child instanceof HTMLElement &&
            child.dataset?.fileTreeId != null &&
            child.dataset.fileTreeId.length > 0
        );
        return fileTreeElement?.dataset?.fileTreeId;
      };

      const clearExistingFileTree = (): void => {
        const children = Array.from(
          fileTreeContainer.shadowRoot?.children ?? []
        );
        const fileTreeElement = children.find(
          (child: Element): child is HTMLElement =>
            child instanceof HTMLElement &&
            child.dataset?.fileTreeId != null &&
            child.dataset.fileTreeId.length > 0
        );
        if (fileTreeElement != null) {
          fileTreeElement.replaceChildren();
        }
      };

      const createInstance = (existingId?: string): FileTree => {
        const sp = statePropsRef.current;
        return new FileTree(
          {
            ...options,
            initialFiles: sp.initialFiles ?? sp.files ?? [],
            id: existingId,
          },
          {
            // Use controlled values as initial state, but do NOT pass them as
            // controlled `expandedItems`/`selectedItems` — those bake into
            // config.state in the Preact Root and override imperative updates.
            // Subsequent controlled updates flow via the useEffect below calling
            // setExpandedItems/setSelectedItems imperatively.
            initialExpandedItems: sp.initialExpandedItems ?? sp.expandedItems,
            initialSelectedItems: sp.initialSelectedItems ?? sp.selectedItems,
            onExpandedItemsChange: sp.onExpandedItemsChange,
            onSelectedItemsChange: sp.onSelectedItemsChange,
            onSelection: sp.onSelection,
            onFilesChange: sp.onFilesChange,
          }
        );
      };

      const setupControlledDnD = (inst: FileTree): void => {
        const sp = statePropsRef.current;
        if (sp.files !== undefined && options.dragAndDrop === true) {
          inst.setCallbacks({
            _onDragMoveFiles: (newFiles) => {
              sp.onFilesChange?.(newFiles);
            },
          });
        }
      };

      const existingFileTreeId = getExistingFileTreeId();

      // Check if this is a re-run due to options change (same container, but new callback identity)
      const isOptionsChange =
        containerRef.current === fileTreeContainer &&
        instanceRef.current != null;

      if (isOptionsChange) {
        // Options changed - clean up and re-create instance
        instanceRef.current?.cleanUp();
        clearExistingFileTree();
        instanceRef.current = createInstance(existingFileTreeId);
        setupControlledDnD(instanceRef.current);
        void instanceRef.current.render({ fileTreeContainer });
      } else {
        // Initial mount
        containerRef.current = fileTreeContainer;

        // If markup already exists in the shadow root (typically via SSR
        // declarative shadow DOM), hydrate it.
        const hasPrerenderedContent = existingFileTreeId != null;

        instanceRef.current = createInstance(existingFileTreeId);
        setupControlledDnD(instanceRef.current);

        if (hasPrerenderedContent) {
          // SSR: hydrate the prerendered HTML
          void instanceRef.current.hydrate({
            fileTreeContainer,
          });
        } else {
          // CSR: render from scratch
          void instanceRef.current.render({ fileTreeContainer });
        }
      }

      return () => {
        instanceRef.current?.cleanUp();
        instanceRef.current = null;
        containerRef.current = null;
      };
    },
    [options]
  );

  // Sync controlled files imperatively (no tree recreation)
  useEffect(() => {
    if (files !== undefined && instanceRef.current != null) {
      instanceRef.current.setFiles(files);
    }
  }, [files]);

  // Sync controlled expanded items imperatively (no tree recreation)
  useEffect(() => {
    if (expandedItems !== undefined && instanceRef.current != null) {
      instanceRef.current.setExpandedItems(expandedItems);
    }
  }, [expandedItems]);

  // Sync controlled selected items imperatively (no tree recreation)
  useEffect(() => {
    if (selectedItems !== undefined && instanceRef.current != null) {
      instanceRef.current.setSelectedItems(selectedItems);
    }
  }, [selectedItems]);

  // Update callbacks without re-rendering Preact
  useEffect(() => {
    instanceRef.current?.setCallbacks({
      onExpandedItemsChange,
      onSelectedItemsChange,
      onSelection,
      onFilesChange,
      // In controlled DnD mode, override to only fire onFilesChange
      // without calling setFiles() directly, letting the parent decide.
      ...(files !== undefined &&
        options.dragAndDrop === true && {
          _onDragMoveFiles: (newFiles) => {
            onFilesChange?.(newFiles);
          },
        }),
    });
  }, [
    onExpandedItemsChange,
    onSelectedItemsChange,
    onSelection,
    onFilesChange,
    files,
    options.dragAndDrop,
  ]);

  return { ref };
}
