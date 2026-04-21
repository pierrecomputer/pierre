/** @jsxImportSource react */
'use client';

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  CONTEXT_MENU_SLOT_NAME,
  FILE_TREE_TAG_NAME,
  HEADER_SLOT_NAME,
} from '../constants';
import type {
  FileTreeCompositionOptions,
  FileTreeContextMenuItem,
  FileTreeContextMenuOpenContext,
  FileTreeSsrPayload,
} from '../model/types';
import type { FileTree as FileTreeModel } from '../render/FileTree';

const useClientLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface ActiveContextMenuState {
  context: FileTreeContextMenuOpenContext;
  item: FileTreeContextMenuItem;
}

export type FileTreePreloadedData = Pick<
  FileTreeSsrPayload,
  'id' | 'shadowHtml'
>;

function renderFileTreeChildren(
  header: ReactNode,
  renderContextMenu:
    | ((
        item: FileTreeContextMenuItem,
        context: FileTreeContextMenuOpenContext
      ) => ReactNode)
    | undefined,
  activeContextMenu: ActiveContextMenuState | null
): ReactNode {
  const headerChild =
    header != null ? <div slot={HEADER_SLOT_NAME}>{header}</div> : null;
  const contextMenuChild =
    renderContextMenu != null && activeContextMenu != null ? (
      <div slot={CONTEXT_MENU_SLOT_NAME}>
        {renderContextMenu(activeContextMenu.item, activeContextMenu.context)}
      </div>
    ) : null;

  if (headerChild == null && contextMenuChild == null) {
    return null;
  }

  return (
    <>
      {headerChild}
      {contextMenuChild}
    </>
  );
}

function renderPreloadedShadowDom(
  children: ReactNode,
  preloadedData: FileTreePreloadedData | undefined
): ReactNode {
  if (typeof window === 'undefined' && preloadedData != null) {
    return (
      <>
        <template
          // @ts-expect-error React does not know the declarative shadow DOM attribute.
          shadowrootmode="open"
          dangerouslySetInnerHTML={{ __html: preloadedData.shadowHtml }}
        />
        {children}
      </>
    );
  }

  return <>{children}</>;
}

function hasExistingPreloadedContent(host: HTMLElement): boolean {
  const shadowRoot = host.shadowRoot;
  if (
    shadowRoot?.querySelector('[data-file-tree-id]') instanceof HTMLElement ||
    shadowRoot?.querySelector('[data-file-tree-id]') instanceof SVGElement
  ) {
    return true;
  }

  return (
    host.querySelector('template[shadowrootmode="open"]') instanceof
    HTMLTemplateElement
  );
}

function resolveComposition(
  baselineComposition: FileTreeCompositionOptions | undefined,
  header: ReactNode,
  hasContextMenu: boolean,
  onClose: () => void,
  onOpen: (
    item: FileTreeContextMenuItem,
    context: FileTreeContextMenuOpenContext
  ) => void
): FileTreeCompositionOptions | undefined {
  const nextComposition: FileTreeCompositionOptions = {
    ...(baselineComposition ?? {}),
  };

  if (header != null) {
    delete nextComposition.header;
  }

  if (hasContextMenu) {
    const baselineContextMenu = baselineComposition?.contextMenu;
    const baselineOnClose = baselineContextMenu?.onClose;
    const baselineOnOpen = baselineContextMenu?.onOpen;

    nextComposition.contextMenu = {
      ...(baselineContextMenu ?? {}),
      enabled: true,
      onClose: () => {
        baselineOnClose?.();
        onClose();
      },
      onOpen: (item, context) => {
        onOpen(item, context);
        baselineOnOpen?.(item, context);
      },
    };
    delete nextComposition.contextMenu.render;
  }

  return nextComposition.header != null || nextComposition.contextMenu != null
    ? nextComposition
    : undefined;
}

export interface FileTreeProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'children'
> {
  header?: ReactNode;
  model: FileTreeModel;
  preloadedData?: FileTreePreloadedData;
  renderContextMenu?: (
    item: FileTreeContextMenuItem,
    context: FileTreeContextMenuOpenContext
  ) => ReactNode;
}

export function FileTree({
  header,
  id,
  model,
  preloadedData,
  renderContextMenu,
  ...hostProps
}: FileTreeProps): React.JSX.Element {
  const [activeContextMenu, setActiveContextMenu] =
    useState<ActiveContextMenuState | null>(null);
  const [hostElement, setHostElement] = useState<HTMLElement | null>(null);
  const baselineCompositionRef = useRef<FileTreeCompositionOptions | undefined>(
    model.getComposition()
  );
  const baselineModelRef = useRef(model);
  if (baselineModelRef.current !== model) {
    baselineModelRef.current = model;
    baselineCompositionRef.current = model.getComposition();
  }

  const hasContextMenu = renderContextMenu != null;
  const handleContextMenuClose = useCallback(() => {
    setActiveContextMenu(null);
  }, []);
  const handleContextMenuOpen = useCallback(
    (
      item: FileTreeContextMenuItem,
      context: FileTreeContextMenuOpenContext
    ) => {
      setActiveContextMenu({ context, item });
    },
    []
  );
  const baselineComposition = baselineCompositionRef.current;
  const composition = useMemo<FileTreeCompositionOptions | undefined>(
    () =>
      resolveComposition(
        baselineComposition,
        header,
        hasContextMenu,
        handleContextMenuClose,
        handleContextMenuOpen
      ),
    [
      baselineComposition,
      handleContextMenuClose,
      handleContextMenuOpen,
      hasContextMenu,
      header,
    ]
  );

  const handleHostRef = useCallback((node: HTMLElement | null) => {
    setHostElement(node);
  }, []);

  useEffect(() => {
    if (hasContextMenu) {
      return;
    }

    setActiveContextMenu(null);
  }, [hasContextMenu]);

  useClientLayoutEffect(() => {
    model.setComposition(composition);
  }, [composition, model]);

  useClientLayoutEffect(() => {
    if (hostElement == null) {
      return;
    }

    if (preloadedData != null && hasExistingPreloadedContent(hostElement)) {
      model.hydrate({ fileTreeContainer: hostElement });
    } else {
      model.render({ fileTreeContainer: hostElement });
    }

    return () => {
      model.unmount();
      model.setComposition(baselineComposition);
    };
  }, [baselineComposition, hostElement, model, preloadedData]);

  const children = renderPreloadedShadowDom(
    renderFileTreeChildren(header, renderContextMenu, activeContextMenu),
    preloadedData
  );
  const resolvedHostId = id ?? preloadedData?.id;

  // Paint the model's resolved density onto the host so callers don't have to
  // set `--trees-item-height` and `--trees-density-override` themselves.
  // Caller-provided `style` keys still win via spread order.
  const mergedStyle: CSSProperties = {
    ['--trees-item-height' as string]: `${String(model.getItemHeight())}px`,
    ['--trees-density-override' as string]: model.getDensityFactor(),
    ...hostProps.style,
  };

  return (
    <FILE_TREE_TAG_NAME
      {...hostProps}
      id={resolvedHostId}
      ref={handleHostRef}
      style={mergedStyle}
      suppressHydrationWarning={preloadedData != null}
    >
      {children}
    </FILE_TREE_TAG_NAME>
  );
}
