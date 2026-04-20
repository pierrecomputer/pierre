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
  CodeViewer as CodeViewerClass,
  type CodeViewerCoordinator,
  type CodeViewerItem,
  type CodeViewerMetrics,
  type CodeViewerOptions,
  type CodeViewerRenderedItem,
  type CodeViewerScrollTarget,
  type DiffLineAnnotation,
  type GetHoveredLineResult,
  type LineAnnotation,
  type SmoothScrollSettings,
  type VirtualFileMetrics,
  type VirtualWindowSpecs,
} from '../index';
import { areManagedSnapshotsEqual } from '../utils/areManagedSnapshotsEqual';
import { renderDiffChildren } from './utils/renderDiffChildren';
import { renderFileChildren } from './utils/renderFileChildren';
import { useStableCallback } from './utils/useStableCallback';
import { WorkerPoolContext } from './WorkerPoolContext';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

type CodeViewerGutterUtilityGetter =
  | (() => GetHoveredLineResult<'file'> | undefined)
  | (() => GetHoveredLineResult<'diff'> | undefined);

interface CodeViewerBaseProps<LAnnotation> {
  options?: CodeViewerOptions<LAnnotation>;
  viewerMetrics?: CodeViewerMetrics;
  metrics?: VirtualFileMetrics;
  smoothScrollSettings?: SmoothScrollSettings;
  className?: string;
  style?: CSSProperties;
  containerRef?: Ref<HTMLDivElement>;
  disableWorkerPool?: boolean;
  onScroll?(scrollTop: number, viewer: CodeViewerClass<LAnnotation>): void;
  renderCustomHeader?(item: CodeViewerItem<LAnnotation>): ReactNode;
  renderHeaderPrefix?(item: CodeViewerItem<LAnnotation>): ReactNode;
  renderHeaderMetadata?(item: CodeViewerItem<LAnnotation>): ReactNode;
  renderAnnotation?(
    annotation: LineAnnotation<LAnnotation> | DiffLineAnnotation<LAnnotation>,
    item: CodeViewerItem<LAnnotation>
  ): ReactNode;
  renderGutterUtility?(
    getHoveredLine: CodeViewerGutterUtilityGetter,
    item: CodeViewerItem<LAnnotation>
  ): ReactNode;
}

export interface ControlledCodeViewerProps<
  LAnnotation,
> extends CodeViewerBaseProps<LAnnotation> {
  items: readonly CodeViewerItem<LAnnotation>[];
  initialItems?: never;
}

export interface UncontrolledCodeViewerProps<
  LAnnotation,
> extends CodeViewerBaseProps<LAnnotation> {
  // FIXME(amadeus): Replace this with a data structure that can do
  // mutation-like changes for super massive diffs
  // initialItems?: readonly CodeViewerItem<LAnnotation>[];
  // items?: never;
  items: readonly CodeViewerItem<LAnnotation>[];
}

export type CodeViewerProps<LAnnotation = undefined> =
  | ControlledCodeViewerProps<LAnnotation>
  | UncontrolledCodeViewerProps<LAnnotation>;

export interface CodeViewerHandle<LAnnotation> {
  scrollTo(target: CodeViewerScrollTarget): void;
  getWindowSpecs(): VirtualWindowSpecs;
  getInstance(): CodeViewerClass<LAnnotation> | undefined;
}

type CodeViewerComponent = <LAnnotation = undefined>(
  props: CodeViewerProps<LAnnotation> & {
    ref?: React.Ref<CodeViewerHandle<LAnnotation>>;
  }
) => React.JSX.Element;

type SlotPortalsComponent = <LAnnotation = undefined>(
  props: SlotPortalsProps<LAnnotation>
) => React.JSX.Element;

interface ManagedContentStore<LAnnotation> {
  getSnapshot(): CodeViewerRenderedItem<LAnnotation>[] | undefined;
  publish(snapshot: CodeViewerRenderedItem<LAnnotation>[] | undefined): void;
  subscribe(listener: () => void): () => void;
}

interface CachedDataRef<LAnnotation> {
  instance: CodeViewerClass<LAnnotation> | undefined;
  items: readonly CodeViewerItem<LAnnotation>[] | undefined;
  managedOptions: CodeViewerOptions<LAnnotation> | undefined;
  disableFlushSync: boolean;
  slotCoordinator: CodeViewerCoordinator<LAnnotation> | undefined;
}

const DEFAULT_CACHE = {
  instance: undefined,
  items: undefined,
  managedOptions: undefined,
  disableFlushSync: false,
  slotCoordinator: undefined,
} as const;

function CodeViewerInner<LAnnotation = undefined>(
  {
    className,
    containerRef,
    disableWorkerPool = false,
    items,
    metrics,
    onScroll,
    options,
    renderAnnotation,
    renderCustomHeader,
    renderGutterUtility,
    renderHeaderMetadata,
    renderHeaderPrefix,
    smoothScrollSettings,
    style,
    viewerMetrics,
  }: CodeViewerProps<LAnnotation>,
  ref: React.ForwardedRef<CodeViewerHandle<LAnnotation>>
): React.JSX.Element {
  const poolManager = useContext(WorkerPoolContext);
  const cachedDataRef = useRef<CachedDataRef<LAnnotation>>({
    ...DEFAULT_CACHE,
  });
  const hasCustomHeader = renderCustomHeader != null;
  const hasAnnotationRenderer = renderAnnotation != null;
  const hasGutterRenderer = renderGutterUtility != null;
  const hasHeaderRenderers =
    hasCustomHeader ||
    renderHeaderPrefix != null ||
    renderHeaderMetadata != null;
  const hasRenderers =
    hasHeaderRenderers || hasAnnotationRenderer || hasGutterRenderer;

  const managedOptions = useMemo(
    () =>
      createManagedCodeViewerOptions({
        options,
        hasCustomHeader,
        hasGutterRenderer,
      }),
    [options, hasCustomHeader, hasGutterRenderer]
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
      cachedDataRef.current = { ...DEFAULT_CACHE };
    }

    // If our node matches the existing node then we should not attempt to
    // setup.  This is a case that should never be possible to hit, but just in
    // case, lets make sure we don't re-setup an instance that is already setup
    // properly
    if (
      node != null &&
      node !== cachedDataRef.current.instance?.getContainerElement()
    ) {
      cachedDataRef.current.instance = new CodeViewerClass<LAnnotation>(
        viewerMetrics,
        managedOptions,
        metrics,
        smoothScrollSettings,
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
    (snapshot: CodeViewerRenderedItem<LAnnotation>[] | undefined) => {
      if (cachedDataRef.current.disableFlushSync) {
        slotContentStore.publish(snapshot);
      } else {
        flushSync(() => {
          slotContentStore.publish(snapshot);
        });
      }
    }
  );

  const slotCoordinator: CodeViewerCoordinator<LAnnotation> | undefined =
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

      if (items !== prevItems) {
        cachedDataRef.current.items = items;
        instance.setItems(items);
        shouldRender = true;
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
    (): CodeViewerHandle<LAnnotation> => ({
      scrollTo(target) {
        const { instance } = cachedDataRef.current;
        if (instance == null) {
          console.error(
            'CodeViewer.scrollTo: no valid instance to scroll with',
            target
          );
        } else {
          instance.scrollTo(target);
        }
      },
      getWindowSpecs() {
        const { instance } = cachedDataRef.current;
        if (instance == null) {
          console.error('CodeViewer.getWindowSpecs: no valid instance exists');
          return { top: 0, bottom: 0 };
        } else {
          return instance.getWindowSpecs();
        }
      },
      getInstance() {
        return cachedDataRef.current.instance;
      },
    }),
    []
  );

  return (
    <>
      <div ref={nodeRef} className={className} style={style} />
      {hasRenderers && (
        <SlotPortals<LAnnotation>
          managedContentStore={slotContentStore}
          renderCustomHeader={renderCustomHeader}
          renderHeaderPrefix={renderHeaderPrefix}
          renderHeaderMetadata={renderHeaderMetadata}
          renderAnnotation={renderAnnotation}
          renderGutterUtility={renderGutterUtility}
        />
      )}
    </>
  );
}

// React was a mistake
export const CodeViewer = forwardRef(CodeViewerInner) as CodeViewerComponent;

function createSlotContentStore<
  LAnnotation,
>(): ManagedContentStore<LAnnotation> {
  let snapshot: CodeViewerRenderedItem<LAnnotation>[] | undefined;
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

interface CreateManagedCodeViewerOptionsProps<LAnnotation> {
  options: CodeViewerOptions<LAnnotation> | undefined;
  hasCustomHeader: boolean;
  hasGutterRenderer: boolean;
}

function createManagedCodeViewerOptions<LAnnotation>({
  options,
  hasCustomHeader,
  hasGutterRenderer,
}: CreateManagedCodeViewerOptionsProps<LAnnotation>):
  | CodeViewerOptions<LAnnotation>
  | undefined {
  if (!hasCustomHeader && !hasGutterRenderer) {
    return options;
  }
  options = { ...options };

  // The imperative CodeViewer adapters use this callback's presence to
  // switch file and diff headers into custom-slot mode. React portals
  // provide the actual header content, so this placeholder
  // intentionally returns nothing.
  if (hasCustomHeader) {
    options.renderCustomHeader = noopRender;
  }

  // The imperative CodeViewer adapters use this callback's presence to
  // create the custom gutter utility slot. React portals provide the
  // actual content, so this placeholder intentionally returns nothing.
  if (hasGutterRenderer) {
    options.renderGutterUtility = noopRender;
  }

  return options;
}

interface RenderCodeViewerItemChildrenProps<LAnnotation> {
  renderedItem: CodeViewerRenderedItem<LAnnotation>;
  renderCustomHeader: CodeViewerBaseProps<LAnnotation>['renderCustomHeader'];
  renderHeaderPrefix: CodeViewerBaseProps<LAnnotation>['renderHeaderPrefix'];
  renderHeaderMetadata: CodeViewerBaseProps<LAnnotation>['renderHeaderMetadata'];
  renderAnnotation: CodeViewerBaseProps<LAnnotation>['renderAnnotation'];
  renderGutterUtility: CodeViewerBaseProps<LAnnotation>['renderGutterUtility'];
}

interface SlotPortalsProps<LAnnotation> {
  managedContentStore: ManagedContentStore<LAnnotation>;
  renderCustomHeader: CodeViewerBaseProps<LAnnotation>['renderCustomHeader'];
  renderHeaderPrefix: CodeViewerBaseProps<LAnnotation>['renderHeaderPrefix'];
  renderHeaderMetadata: CodeViewerBaseProps<LAnnotation>['renderHeaderMetadata'];
  renderAnnotation: CodeViewerBaseProps<LAnnotation>['renderAnnotation'];
  renderGutterUtility: CodeViewerBaseProps<LAnnotation>['renderGutterUtility'];
}

const SlotPortals = memo(function SlotPortals<LAnnotation>({
  managedContentStore,
  renderCustomHeader,
  renderHeaderPrefix,
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
    CodeViewerRenderedItem<LAnnotation>[] | undefined
  >(subscribe, getSnapshot, getSnapshot);
  return renderedItems?.map((renderedItem) => {
    return createPortal(
      renderCodeViewerItemChildren({
        renderedItem,
        renderCustomHeader,
        renderHeaderPrefix,
        renderHeaderMetadata,
        renderAnnotation,
        renderGutterUtility,
      }),
      renderedItem.element,
      renderedItem.id
    );
  });
}) as SlotPortalsComponent;

function renderCodeViewerItemChildren<LAnnotation>({
  renderedItem,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderMetadata,
  renderAnnotation,
  renderGutterUtility,
}: RenderCodeViewerItemChildrenProps<LAnnotation>): ReactNode {
  if (renderedItem.type === 'diff') {
    const { item, instance } = renderedItem;
    return renderDiffChildren({
      fileDiff: item.fileDiff,
      renderCustomHeader:
        renderCustomHeader != null ? () => renderCustomHeader(item) : undefined,
      renderHeaderPrefix:
        renderHeaderPrefix != null ? () => renderHeaderPrefix(item) : undefined,
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
