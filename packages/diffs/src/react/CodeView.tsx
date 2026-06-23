'use client';

import {
  type CSSProperties,
  forwardRef,
  memo,
  type ReactNode,
  type Ref,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal, flushSync } from 'react-dom';

import {
  areOptionsEqual,
  CodeView as CodeViewClass,
  type CodeViewCoordinator,
  type CodeViewItem,
  type CodeViewLineSelection,
  type CodeViewOptions,
  type CodeViewRenderedItem,
  type CodeViewScrollTarget,
  type DiffLineAnnotation,
  type GetHoveredLineResult,
  type LineAnnotation,
} from '../index';
import { areManagedSnapshotsEqual } from '../utils/areManagedSnapshotsEqual';
import { renderDiffChildren } from './utils/renderDiffChildren';
import { renderFileChildren } from './utils/renderFileChildren';
import { useStableCallback } from './utils/useStableCallback';
import { WorkerPoolContext } from './WorkerPoolContext';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

type CodeViewGutterUtilityGetter =
  | (() => GetHoveredLineResult<'file'> | undefined)
  | (() => GetHoveredLineResult<'diff'> | undefined);

interface CodeViewBaseProps<LAnnotation> {
  options?: CodeViewOptions<LAnnotation>;
  className?: string;
  style?: CSSProperties;
  containerRef?: Ref<HTMLDivElement>;
  disableWorkerPool?: boolean;
  selectedLines?: CodeViewLineSelection | null;
  onSelectedLinesChange?(selection: CodeViewLineSelection | null): void;
  onScroll?(scrollTop: number, viewer: CodeViewClass<LAnnotation>): void;
  renderCustomHeader?(item: CodeViewItem<LAnnotation>): ReactNode;
  renderHeaderPrefix?(item: CodeViewItem<LAnnotation>): ReactNode;
  renderHeaderFilenameSuffix?(item: CodeViewItem<LAnnotation>): ReactNode;
  renderHeaderMetadata?(item: CodeViewItem<LAnnotation>): ReactNode;
  renderAnnotation?(
    annotation: LineAnnotation<LAnnotation> | DiffLineAnnotation<LAnnotation>,
    item: CodeViewItem<LAnnotation>
  ): ReactNode;
  renderGutterUtility?(
    getHoveredLine: CodeViewGutterUtilityGetter,
    item: CodeViewItem<LAnnotation>
  ): ReactNode;
}

export interface ControlledCodeViewProps<
  LAnnotation,
> extends CodeViewBaseProps<LAnnotation> {
  items: readonly CodeViewItem<LAnnotation>[];
  initialItems?: never;
}

export interface UncontrolledCodeViewProps<
  LAnnotation,
> extends CodeViewBaseProps<LAnnotation> {
  // Seeds the imperative CodeView instance once. Later item changes should go
  // through the ref API instead of being reconciled from React props.
  initialItems?: readonly CodeViewItem<LAnnotation>[];
  items?: never;
}

export type CodeViewProps<LAnnotation = undefined> =
  | ControlledCodeViewProps<LAnnotation>
  | UncontrolledCodeViewProps<LAnnotation>;

export interface CodeViewHandle<LAnnotation> {
  addItems(items: readonly CodeViewItem<LAnnotation>[]): void;
  getItem(id: string): CodeViewItem<LAnnotation> | undefined;
  updateItem(item: CodeViewItem<LAnnotation>): boolean;
  updateItemId(oldId: string, newId: string): boolean;
  scrollTo(target: CodeViewScrollTarget): void;
  setSelectedLines(selection: CodeViewLineSelection | null): void;
  getSelectedLines(): CodeViewLineSelection | null;
  clearSelectedLines(): void;
  getInstance(): CodeViewClass<LAnnotation> | undefined;
}

type CodeViewComponent = <LAnnotation = undefined>(
  props: CodeViewProps<LAnnotation> & {
    ref?: React.Ref<CodeViewHandle<LAnnotation>>;
  }
) => React.JSX.Element;

type SlotPortalsComponent = <LAnnotation = undefined>(
  props: SlotPortalsProps<LAnnotation>
) => React.JSX.Element;

interface ManagedContentStore<LAnnotation> {
  getSnapshot(): CodeViewRenderedItem<LAnnotation>[] | undefined;
  publish(snapshot: CodeViewRenderedItem<LAnnotation>[] | undefined): void;
  subscribe(listener: () => void): () => void;
}

interface CachedDataRef<LAnnotation> {
  instance: CodeViewClass<LAnnotation> | undefined;
  items: readonly CodeViewItem<LAnnotation>[] | undefined;
  controlled: boolean;
  managedOptions: CodeViewOptions<LAnnotation> | undefined;
  disableFlushSync: boolean;
  slotCoordinator: CodeViewCoordinator<LAnnotation> | undefined;
}

function createDefaultCache<LAnnotation>(
  controlled: boolean
): CachedDataRef<LAnnotation> {
  return {
    instance: undefined,
    items: undefined,
    controlled,
    managedOptions: undefined,
    disableFlushSync: false,
    slotCoordinator: undefined,
  };
}

function CodeViewInner<LAnnotation = undefined>(
  props: CodeViewProps<LAnnotation>,
  ref: React.ForwardedRef<CodeViewHandle<LAnnotation>>
): React.JSX.Element {
  const {
    className,
    containerRef,
    disableWorkerPool = false,
    initialItems,
    items: controlledItems,
    onScroll,
    onSelectedLinesChange,
    options,
    renderAnnotation,
    renderCustomHeader,
    renderGutterUtility,
    renderHeaderFilenameSuffix,
    renderHeaderMetadata,
    renderHeaderPrefix,
    selectedLines,
    style,
  } = props;
  const controlled = controlledItems !== undefined;
  const poolManager = useContext(WorkerPoolContext);
  const cachedDataRef = useRef<CachedDataRef<LAnnotation>>(
    createDefaultCache<LAnnotation>(controlled)
  );
  const hasCustomHeader = renderCustomHeader != null;
  const hasAnnotationRenderer = renderAnnotation != null;
  const hasGutterRenderer = renderGutterUtility != null;
  const hasHeaderRenderers =
    hasCustomHeader ||
    renderHeaderPrefix != null ||
    renderHeaderFilenameSuffix != null ||
    renderHeaderMetadata != null;
  const hasRenderers =
    hasHeaderRenderers || hasAnnotationRenderer || hasGutterRenderer;
  const emitSelectedLinesChange = useStableCallback(
    (selection: CodeViewLineSelection | null) => {
      onSelectedLinesChange?.(selection);
    }
  );
  const controlledSelection = selectedLines !== undefined;

  const managedOptions = useMemo(
    () =>
      createManagedCodeViewOptions({
        options,
        hasCustomHeader,
        hasGutterRenderer,
        onSelectedLinesChange:
          onSelectedLinesChange != null ? emitSelectedLinesChange : undefined,
        controlledSelection,
      }),
    [
      options,
      hasCustomHeader,
      hasGutterRenderer,
      onSelectedLinesChange,
      emitSelectedLinesChange,
      controlledSelection,
    ]
  );

  const [slotContentStore] = useState<ManagedContentStore<LAnnotation>>(() =>
    createSlotContentStore()
  );
  const [, forceUpdate] = useState<unknown>({});

  const nodeRef = useStableCallback((node: HTMLDivElement | null) => {
    // If we have a pre-existing instance and there's no node or the node being
    // passed in is NOT the same as before, then we need to clean up and
    // garbage collect the old instance
    if (
      cachedDataRef.current.instance != null &&
      (node == null ||
        node !== cachedDataRef.current.instance.getContainerElement())
    ) {
      cachedDataRef.current.instance.cleanUp();
      slotContentStore.publish(undefined);
      cachedDataRef.current = createDefaultCache<LAnnotation>(controlled);
    }

    // If our node matches the existing node then we should not attempt to
    // setup.  This is a case that should never be possible to hit, but just in
    // case, lets make sure we don't re-setup an instance that is already setup
    // properly
    if (
      node != null &&
      node !== cachedDataRef.current.instance?.getContainerElement()
    ) {
      cachedDataRef.current.instance = new CodeViewClass<LAnnotation>(
        managedOptions,
        !disableWorkerPool ? poolManager : undefined,
        true
      );
      cachedDataRef.current.instance.setup(node);
    }

    if (typeof containerRef === 'function') {
      containerRef(node);
    } else if (containerRef != null) {
      containerRef.current = node;
    }
  });

  const onSnapshotChange = useStableCallback(
    (snapshot: CodeViewRenderedItem<LAnnotation>[] | undefined) => {
      if (cachedDataRef.current.disableFlushSync) {
        slotContentStore.publish(snapshot);
      } else {
        flushSync(() => {
          slotContentStore.publish(snapshot);
        });
      }
    }
  );

  const slotCoordinator: CodeViewCoordinator<LAnnotation> | undefined =
    useMemo(() => {
      if (!hasHeaderRenderers && !hasAnnotationRenderer && !hasGutterRenderer) {
        return undefined;
      } else {
        return {
          hasHeaderRenderers,
          hasAnnotationRenderer,
          hasGutterRenderer,
          onSnapshotChange,
        };
      }
    }, [
      onSnapshotChange,
      hasAnnotationRenderer,
      hasGutterRenderer,
      hasHeaderRenderers,
    ]);

  useIsometricEffect(() => {
    return onScroll != null
      ? cachedDataRef.current.instance?.subscribeToScroll(onScroll)
      : undefined;
  });

  useIsometricEffect(() => {
    const {
      instance,
      controlled: prevControlled,
      items: prevItems,
      managedOptions: prevManagedOptions,
      slotCoordinator: prevSlotCoordinator,
    } = cachedDataRef.current;
    if (instance == null) {
      return;
    }

    try {
      cachedDataRef.current.disableFlushSync = true;
      let shouldRender = false;

      if (!areOptionsEqual(managedOptions, prevManagedOptions)) {
        cachedDataRef.current.managedOptions = managedOptions;
        instance.setOptions(managedOptions);
        shouldRender = true;
      }

      if (prevControlled !== controlled) {
        console.error(
          'CodeView: cannot switch between controlled and uncontrolled modes. Remount with a new key instead.'
        );
        return;
      }

      if (controlled) {
        if (controlledItems !== prevItems) {
          if (areItemListsEqual(prevItems, controlledItems)) {
            cachedDataRef.current.items = controlledItems;
          } else if (isAppendOnlyItemUpdate(prevItems, controlledItems)) {
            cachedDataRef.current.items = controlledItems;
            instance.addItems(controlledItems.slice(prevItems.length));
          } else {
            cachedDataRef.current.items = controlledItems;
            instance.setItems(controlledItems);
            shouldRender = true;
          }
        }
      }
      // If uncontrolled, we should only ever set items once, and just depend
      // on imperative instance changes going forward
      else if (prevItems == null) {
        const seedItems = initialItems ?? [];
        cachedDataRef.current.items = seedItems;
        if (seedItems.length > 0) {
          instance.setItems(seedItems);
          shouldRender = true;
        }
      }

      if (selectedLines !== undefined) {
        instance.setSelectedLines(selectedLines, { notify: false });
      }

      const slotPublish = instance.setSlotCoordinator(slotCoordinator);
      let forceInlinePublish = false;
      if (slotCoordinator !== prevSlotCoordinator) {
        if (slotCoordinator == null || prevSlotCoordinator == null) {
          forceInlinePublish = true;
        }
        cachedDataRef.current.slotCoordinator = slotCoordinator;
      }

      if (shouldRender || slotPublish) {
        instance.render(true);
      }

      // FIXME(amadeus): This feels kinda bad and flakey with regards to how
      // other things are working... it makes me think that we should
      // re-architect the slotCoordinator a bit, and maybe DON'T make it an
      // undefineable thing...
      if (slotPublish && slotCoordinator == null) {
        slotContentStore.publish(undefined);
      }

      if (forceInlinePublish) {
        forceUpdate({});
      }
    } finally {
      cachedDataRef.current.disableFlushSync = false;
    }
  });

  // Setup the ref handler
  useImperativeHandle(
    ref,
    (): CodeViewHandle<LAnnotation> => ({
      addItems(items) {
        const { controlled, instance } = cachedDataRef.current;
        assertUncontrolledCodeViewAction(controlled, 'addItems');
        if (instance == null) {
          console.error(
            'CodeView.addItems: no valid instance to append items with',
            items
          );
        } else {
          instance.addItems(items);
        }
      },
      getItem(id) {
        const { instance } = cachedDataRef.current;
        if (instance == null) {
          console.error('CodeView.getItem: no valid instance exists', id);
          return undefined;
        } else {
          return instance.getItem(id);
        }
      },
      updateItem(item) {
        const { controlled, instance } = cachedDataRef.current;
        assertUncontrolledCodeViewAction(controlled, 'updateItem');
        if (instance == null) {
          console.error(
            'CodeView.updateItem: no valid instance to update item with',
            item
          );
          return false;
        }

        return instance.updateItem(item);
      },
      updateItemId(oldId, newId) {
        const { controlled, instance } = cachedDataRef.current;
        assertUncontrolledCodeViewAction(controlled, 'updateItemId');
        if (instance == null) {
          console.error(
            'CodeView.updateItemId: no valid instance to update item id with',
            oldId,
            newId
          );
          return false;
        }

        return instance.updateItemId(oldId, newId);
      },
      scrollTo(target) {
        const { instance } = cachedDataRef.current;
        if (instance == null) {
          console.error(
            'CodeView.scrollTo: no valid instance to scroll with',
            target
          );
        } else {
          instance.scrollTo(target);
        }
      },
      setSelectedLines(selection) {
        const { instance } = cachedDataRef.current;
        if (instance == null) {
          console.error(
            'CodeView.setSelectedLines: no valid instance to update selection with',
            selection
          );
        } else {
          instance.setSelectedLines(selection, { notify: false });
          emitSelectedLinesChange(selection);
        }
      },
      getSelectedLines() {
        const { instance } = cachedDataRef.current;
        if (instance == null) {
          console.error('CodeView.getSelectedLines: no valid instance exists');
          return null;
        } else {
          return instance.getSelectedLines();
        }
      },
      clearSelectedLines() {
        const { instance } = cachedDataRef.current;
        if (instance == null) {
          console.error(
            'CodeView.clearSelectedLines: no valid instance to update selection with'
          );
        } else {
          instance.clearSelectedLines({ notify: false });
          emitSelectedLinesChange(null);
        }
      },
      getInstance() {
        return cachedDataRef.current.instance;
      },
    }),
    [emitSelectedLinesChange]
  );

  return (
    <>
      <div ref={nodeRef} className={className} style={style} />
      {hasRenderers && (
        <SlotPortals<LAnnotation>
          managedContentStore={slotContentStore}
          renderCustomHeader={renderCustomHeader}
          renderHeaderPrefix={renderHeaderPrefix}
          renderHeaderFilenameSuffix={renderHeaderFilenameSuffix}
          renderHeaderMetadata={renderHeaderMetadata}
          renderAnnotation={renderAnnotation}
          renderGutterUtility={renderGutterUtility}
        />
      )}
    </>
  );
}

// React was a mistake
export const CodeView = forwardRef(CodeViewInner) as CodeViewComponent;

function isAppendOnlyItemUpdate<LAnnotation>(
  previousItems: readonly CodeViewItem<LAnnotation>[] | undefined,
  nextItems: readonly CodeViewItem<LAnnotation>[]
): previousItems is readonly CodeViewItem<LAnnotation>[] {
  if (previousItems == null || nextItems.length <= previousItems.length) {
    return false;
  }

  if (previousItems.length === 0) {
    return true;
  }

  for (let index = 0; index < previousItems.length; index++) {
    if (nextItems[index] !== previousItems[index]) {
      return false;
    }
  }

  return true;
}

function areItemListsEqual<LAnnotation>(
  previousItems: readonly CodeViewItem<LAnnotation>[] | undefined,
  nextItems: readonly CodeViewItem<LAnnotation>[]
): boolean {
  if (previousItems == null || previousItems.length !== nextItems.length) {
    return false;
  }

  for (let index = 0; index < previousItems.length; index++) {
    if (previousItems[index] !== nextItems[index]) {
      return false;
    }
  }

  return true;
}

function assertUncontrolledCodeViewAction(
  controlled: boolean,
  action: string
): void {
  if (!controlled) {
    return;
  }

  throw new Error(
    `CodeView.${action} cannot be used when CodeView is controlled. Use initialItems for imperative item updates.`
  );
}

function createSlotContentStore<
  LAnnotation,
>(): ManagedContentStore<LAnnotation> {
  let snapshot: CodeViewRenderedItem<LAnnotation>[] | undefined;
  const listeners = new Set<() => void>();

  return {
    getSnapshot() {
      return snapshot;
    },
    publish(nextSnapshot) {
      if (areManagedSnapshotsEqual(snapshot, nextSnapshot)) {
        return;
      }

      snapshot = nextSnapshot;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

interface CreateManagedCodeViewOptionsProps<LAnnotation> {
  options: CodeViewOptions<LAnnotation> | undefined;
  hasCustomHeader: boolean;
  hasGutterRenderer: boolean;
  onSelectedLinesChange?(selection: CodeViewLineSelection | null): void;
  controlledSelection: boolean;
}

function createManagedCodeViewOptions<LAnnotation>({
  options,
  hasCustomHeader,
  hasGutterRenderer,
  onSelectedLinesChange,
  controlledSelection,
}: CreateManagedCodeViewOptionsProps<LAnnotation>):
  | CodeViewOptions<LAnnotation>
  | undefined {
  if (
    !hasCustomHeader &&
    !hasGutterRenderer &&
    onSelectedLinesChange == null &&
    !controlledSelection
  ) {
    return options;
  }
  options = { ...options, controlledSelection, onSelectedLinesChange };

  // The imperative CodeView adapters use this callback's presence to
  // switch file and diff headers into custom-slot mode. React portals
  // provide the actual header content, so this placeholder
  // intentionally returns nothing.
  if (hasCustomHeader) {
    options.renderCustomHeader = noopRender;
  }

  // The imperative CodeView adapters use this callback's presence to
  // create the custom gutter utility slot. React portals provide the
  // actual content, so this placeholder intentionally returns nothing.
  if (hasGutterRenderer) {
    options.renderGutterUtility = noopRender;
  }

  return options;
}

interface RenderCodeViewItemChildrenProps<LAnnotation> {
  renderedItem: CodeViewRenderedItem<LAnnotation>;
  renderCustomHeader: CodeViewBaseProps<LAnnotation>['renderCustomHeader'];
  renderHeaderPrefix: CodeViewBaseProps<LAnnotation>['renderHeaderPrefix'];
  renderHeaderFilenameSuffix: CodeViewBaseProps<LAnnotation>['renderHeaderFilenameSuffix'];
  renderHeaderMetadata: CodeViewBaseProps<LAnnotation>['renderHeaderMetadata'];
  renderAnnotation: CodeViewBaseProps<LAnnotation>['renderAnnotation'];
  renderGutterUtility: CodeViewBaseProps<LAnnotation>['renderGutterUtility'];
}

interface SlotPortalsProps<LAnnotation> {
  managedContentStore: ManagedContentStore<LAnnotation>;
  renderCustomHeader: CodeViewBaseProps<LAnnotation>['renderCustomHeader'];
  renderHeaderPrefix: CodeViewBaseProps<LAnnotation>['renderHeaderPrefix'];
  renderHeaderFilenameSuffix: CodeViewBaseProps<LAnnotation>['renderHeaderFilenameSuffix'];
  renderHeaderMetadata: CodeViewBaseProps<LAnnotation>['renderHeaderMetadata'];
  renderAnnotation: CodeViewBaseProps<LAnnotation>['renderAnnotation'];
  renderGutterUtility: CodeViewBaseProps<LAnnotation>['renderGutterUtility'];
}

const SlotPortals = memo(function SlotPortals<LAnnotation>({
  managedContentStore,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  renderAnnotation,
  renderGutterUtility,
}: SlotPortalsProps<LAnnotation>) {
  const subscribe = useStableCallback((listener: () => void) =>
    managedContentStore.subscribe(listener)
  );
  const getSnapshot = useStableCallback(() =>
    managedContentStore.getSnapshot()
  );
  const renderedItems = useSyncExternalStore<
    CodeViewRenderedItem<LAnnotation>[] | undefined
  >(subscribe, getSnapshot, getSnapshot);
  return renderedItems?.map((renderedItem) => {
    return createPortal(
      renderCodeViewItemChildren({
        renderedItem,
        renderCustomHeader,
        renderHeaderPrefix,
        renderHeaderFilenameSuffix,
        renderHeaderMetadata,
        renderAnnotation,
        renderGutterUtility,
      }),
      renderedItem.element,
      renderedItem.id
    );
  });
}) as SlotPortalsComponent;

function renderCodeViewItemChildren<LAnnotation>({
  renderedItem,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  renderAnnotation,
  renderGutterUtility,
}: RenderCodeViewItemChildrenProps<LAnnotation>): ReactNode {
  if (renderedItem.type === 'diff') {
    const { item, instance } = renderedItem;
    return renderDiffChildren({
      fileDiff: item.fileDiff,
      renderCustomHeader:
        renderCustomHeader != null ? () => renderCustomHeader(item) : undefined,
      renderHeaderPrefix:
        renderHeaderPrefix != null ? () => renderHeaderPrefix(item) : undefined,
      renderHeaderFilenameSuffix:
        renderHeaderFilenameSuffix != null
          ? () => renderHeaderFilenameSuffix(item)
          : undefined,
      renderHeaderMetadata:
        renderHeaderMetadata != null
          ? () => renderHeaderMetadata(item)
          : undefined,
      renderAnnotation:
        renderAnnotation != null
          ? (annotation) => renderAnnotation(annotation, item)
          : undefined,
      lineAnnotations: item.annotations,
      renderGutterUtility:
        renderGutterUtility != null
          ? (getHoveredLine) => renderGutterUtility(getHoveredLine, item)
          : undefined,
      getHoveredLine: instance.getHoveredLine,
    });
  } else {
    const { item, instance } = renderedItem;
    return renderFileChildren({
      file: item.file,
      renderCustomHeader:
        renderCustomHeader != null ? () => renderCustomHeader(item) : undefined,
      renderHeaderPrefix:
        renderHeaderPrefix != null ? () => renderHeaderPrefix(item) : undefined,
      renderHeaderFilenameSuffix:
        renderHeaderFilenameSuffix != null
          ? () => renderHeaderFilenameSuffix(item)
          : undefined,
      renderHeaderMetadata:
        renderHeaderMetadata != null
          ? () => renderHeaderMetadata(item)
          : undefined,
      renderAnnotation:
        renderAnnotation != null
          ? (annotation) => renderAnnotation(annotation, item)
          : undefined,
      lineAnnotations: item.annotations,
      renderGutterUtility:
        renderGutterUtility != null
          ? (getHoveredLine) => renderGutterUtility(getHoveredLine, item)
          : undefined,
      getHoveredLine: instance.getHoveredLine,
    });
  }
}

function noopRender() {
  return undefined;
}
