/** @jsxImportSource react */
'use client';

import type { HTMLAttributes, ReactNode } from 'react';
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
} from '../../constants';
import type { PathStoreFileTree } from '../file-tree';
import type {
  PathStoreFileTreeSsrPayload,
  PathStoreTreesCompositionOptions,
  PathStoreTreesContextMenuItem,
  PathStoreTreesContextMenuOpenContext,
} from '../types';

const useClientLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface ActiveContextMenuState {
  context: PathStoreTreesContextMenuOpenContext;
  item: PathStoreTreesContextMenuItem;
}

export type FileTreePreloadedData = Pick<
  PathStoreFileTreeSsrPayload,
  'id' | 'shadowHtml'
>;

function renderFileTreeChildren(
  header: ReactNode,
  renderContextMenu:
    | ((
        item: PathStoreTreesContextMenuItem,
        context: PathStoreTreesContextMenuOpenContext
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
  baselineComposition: PathStoreTreesCompositionOptions | undefined,
  header: ReactNode,
  hasContextMenu: boolean,
  onClose: () => void,
  onOpen: (
    item: PathStoreTreesContextMenuItem,
    context: PathStoreTreesContextMenuOpenContext
  ) => void
): PathStoreTreesCompositionOptions | undefined {
  const nextComposition: PathStoreTreesCompositionOptions = {
    ...(baselineComposition ?? {}),
  };

  if (header != null) {
    delete nextComposition.header;
  }

  if (hasContextMenu) {
    nextComposition.contextMenu = {
      enabled: true,
      onClose,
      onOpen,
    };
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
  model: PathStoreFileTree;
  preloadedData?: FileTreePreloadedData;
  renderContextMenu?: (
    item: PathStoreTreesContextMenuItem,
    context: PathStoreTreesContextMenuOpenContext
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
  const baselineCompositionRef = useRef<
    PathStoreTreesCompositionOptions | undefined
  >(model.getComposition());
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
      item: PathStoreTreesContextMenuItem,
      context: PathStoreTreesContextMenuOpenContext
    ) => {
      setActiveContextMenu({ context, item });
    },
    []
  );
  const baselineComposition = baselineCompositionRef.current;
  const composition = useMemo<PathStoreTreesCompositionOptions | undefined>(
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

  return (
    <FILE_TREE_TAG_NAME
      {...hostProps}
      id={resolvedHostId}
      ref={handleHostRef}
      suppressHydrationWarning={preloadedData != null}
    >
      {children}
    </FILE_TREE_TAG_NAME>
  );
}
