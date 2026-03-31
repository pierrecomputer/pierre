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

import type { EditorChangeEvent, EditorOptions } from '../edit';
import {
  areOptionsEqual,
  CodeView as CodeViewClass,
  type CodeViewCoordinator,
  type CodeViewCreateEditorOptions,
  type CodeViewItem,
  type CodeViewItemEditCompleteEventMap,
  type CodeViewItemEditCompleteHandler,
  type CodeViewLineSelection,
  type CodeViewMode,
  type CodeViewModeItemMap,
  type CodeViewOptions,
  type CodeViewRenderedItem,
  type CodeViewScrollTarget,
  type CodeViewSlotSnapshot,
  type DiffLineAnnotation,
  type DiffsEditor,
  type EditorDocumentKind,
  type GetHoveredLineResult,
  type LineAnnotation,
} from '../index';
import { areManagedSnapshotsEqual } from '../utils/areManagedSnapshotsEqual';
import { useCreateEditor } from './EditContext';
import { renderDiffChildren } from './utils/renderDiffChildren';
import { renderFileChildren } from './utils/renderFileChildren';
import { useStableCallback } from './utils/useStableCallback';
import { WorkerPoolContext } from './WorkerPoolContext';

export type { CodeViewItemEditCompleteHandler };

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

type CodeViewGutterUtilityGetter =
  | (() => GetHoveredLineResult<'file'> | undefined)
  | (() => GetHoveredLineResult<'diff'> | undefined);

export type CodeViewReactOptions<
  LAnnotation = undefined,
  LDecoration = undefined,
> = Omit<
  CodeViewOptions<LAnnotation, LDecoration>,
  'controlledSelection' | 'createEditor' | 'onSelectedLinesChange'
>;

interface CodeViewBaseProps<LAnnotation, LDecoration> {
  options?: CodeViewReactOptions<LAnnotation, LDecoration>;
  /**
   * Creation-time options passed to the nearest EditProvider factory.
   * CodeView supplies its item-specific change callback.
   */
  editorOptions?: Omit<EditorOptions<LAnnotation>, 'onChange'>;
  /** Resolve an in-memory retention key for an item's draft and undo history. */
  getEditStateKey?(
    item: CodeViewItem<LAnnotation, LDecoration>
  ): string | undefined;
  className?: string;
  style?: CSSProperties;
  containerRef?: Ref<HTMLDivElement>;
  disableWorkerPool?: boolean;
  selectedLines?: CodeViewLineSelection | null;
  onSelectedLinesChange?(selection: CodeViewLineSelection | null): void;
  onScroll?(
    scrollTop: number,
    viewer: CodeViewClass<LAnnotation, LDecoration>
  ): void;
  /** Render a non-virtualized node at the very start of the scroll content,
   * before the first item. Always rendered; scrolls with the content. */
  renderCodeViewHeader?(): ReactNode;
  /** Render a non-virtualized node at the very end of the scroll content, after
   * the last item. Always rendered; scrolls with the content. */
  renderCodeViewFooter?(): ReactNode;
  /**
   * Called with the editor's `EditorChangeEvent` and the owning item on every
   * document change. Do not feed it directly back into the controlled item,
   * which can create update loops.
   */
  onItemEditChange?(
    event: EditorChangeEvent<LAnnotation, 'file' | 'diff'>,
    item: CodeViewItem<LAnnotation, LDecoration>
  ): void;
  /**
   * Called once when an edit session ends: edit turned off, the item removed,
   * or the CodeView unmounted (where the result is not installed). Collapse
   * suspends the session instead of completing it. `nextItem` is the accepted
   * replacement CodeView built from `item`: the event's completed
   * `file`/`fileDiff` and annotations, `edit: false`, and a bumped `version`.
   * Return `'accept'` to install the edit — CodeView applies `nextItem` through
   * the item update path when the item still exists, and a controlled owner
   * puts the same `nextItem` into its state — or `'reject'` to revert. The event
   * is frozen; re-key the accepted value in place before accepting.
   */
  onItemEditComplete?: CodeViewItemEditCompleteHandler<
    LAnnotation,
    LDecoration
  >;
  renderCustomHeader?(item: CodeViewItem<LAnnotation, LDecoration>): ReactNode;
  renderHeaderPrefix?(item: CodeViewItem<LAnnotation, LDecoration>): ReactNode;
  renderHeaderFilenameSuffix?(
    item: CodeViewItem<LAnnotation, LDecoration>
  ): ReactNode;
  renderHeaderMetadata?(
    item: CodeViewItem<LAnnotation, LDecoration>
  ): ReactNode;
  renderAnnotation?(
    annotation: LineAnnotation<LAnnotation> | DiffLineAnnotation<LAnnotation>,
    item: CodeViewItem<LAnnotation, LDecoration>
  ): ReactNode;
  renderGutterUtility?(
    getHoveredLine: CodeViewGutterUtilityGetter,
    item: CodeViewItem<LAnnotation, LDecoration>
  ): ReactNode;
}

export interface ControlledCodeViewProps<
  LAnnotation,
  LDecoration = undefined,
> extends CodeViewBaseProps<LAnnotation, LDecoration> {
  items: readonly CodeViewItem<LAnnotation, LDecoration>[];
  initialItems?: never;
}

export interface UncontrolledCodeViewProps<
  LAnnotation,
  LDecoration = undefined,
> extends CodeViewBaseProps<LAnnotation, LDecoration> {
  // Seeds the imperative CodeView instance once. Later item changes should go
  // through the ref API instead of being reconciled from React props.
  initialItems?: readonly CodeViewItem<LAnnotation, LDecoration>[];
  items?: never;
}

export type CodeViewProps<LAnnotation = undefined, LDecoration = undefined> =
  | ControlledCodeViewProps<LAnnotation, LDecoration>
  | UncontrolledCodeViewProps<LAnnotation, LDecoration>;

export interface CodeViewHandle<LAnnotation, LDecoration = undefined> {
  addItems(items: readonly CodeViewItem<LAnnotation, LDecoration>[]): void;
  getItem(id: string): CodeViewItem<LAnnotation, LDecoration> | undefined;
  removeItem(id: string): boolean;
  updateItem(item: CodeViewItem<LAnnotation, LDecoration>): boolean;
  updateItemId(oldId: string, newId: string): boolean;
  scrollTo(target: CodeViewScrollTarget): void;
  setSelectedLines(selection: CodeViewLineSelection | null): void;
  getSelectedLines(): CodeViewLineSelection | null;
  clearSelectedLines(): void;
  getEditor(id: string): DiffsEditor<LAnnotation> | undefined;
  getInstance(): CodeViewClass<LAnnotation, LDecoration> | undefined;
}

type CodeViewComponent = <LAnnotation = undefined, LDecoration = undefined>(
  props: CodeViewProps<LAnnotation, LDecoration> & {
    ref?: React.Ref<CodeViewHandle<LAnnotation, LDecoration>>;
  }
) => React.JSX.Element;

type SlotPortalsComponent = <LAnnotation = undefined, LDecoration = undefined>(
  props: SlotPortalsProps<LAnnotation, LDecoration>
) => React.JSX.Element;

interface ManagedContentStore<LAnnotation, LDecoration> {
  getSnapshot(): CodeViewSlotSnapshot<LAnnotation, LDecoration> | undefined;
  publish(
    snapshot: CodeViewSlotSnapshot<LAnnotation, LDecoration> | undefined
  ): void;
  subscribe(listener: () => void): () => void;
}

interface CachedDataRef<LAnnotation, LDecoration> {
  instance: CodeViewClass<LAnnotation, LDecoration> | undefined;
  items: readonly CodeViewItem<LAnnotation, LDecoration>[] | undefined;
  controlled: boolean;
  managedOptions: CodeViewOptions<LAnnotation, LDecoration> | undefined;
  disableFlushSync: boolean;
  slotCoordinator: CodeViewCoordinator<LAnnotation, LDecoration> | undefined;
}

function createDefaultCache<LAnnotation, LDecoration>(
  controlled: boolean
): CachedDataRef<LAnnotation, LDecoration> {
  return {
    instance: undefined,
    items: undefined,
    controlled,
    managedOptions: undefined,
    disableFlushSync: false,
    slotCoordinator: undefined,
  };
}

function CodeViewInner<LAnnotation = undefined, LDecoration = undefined>(
  props: CodeViewProps<LAnnotation, LDecoration>,
  ref: React.ForwardedRef<CodeViewHandle<LAnnotation, LDecoration>>
): React.JSX.Element {
  const {
    className,
    containerRef,
    disableWorkerPool = false,
    editorOptions,
    getEditStateKey,
    initialItems,
    items: controlledItems,
    onItemEditChange,
    onItemEditComplete,
    onScroll,
    onSelectedLinesChange,
    options,
    renderAnnotation,
    renderCodeViewFooter,
    renderCodeViewHeader,
    renderCustomHeader,
    renderGutterUtility,
    renderHeaderFilenameSuffix,
    renderHeaderMetadata,
    renderHeaderPrefix,
    selectedLines,
    style,
  } = props;
  const controlled = controlledItems !== undefined;
  const contextCreateEditor = useCreateEditor<LAnnotation>();
  const poolManager = useContext(WorkerPoolContext);
  const cachedDataRef = useRef<CachedDataRef<LAnnotation, LDecoration>>(
    createDefaultCache<LAnnotation, LDecoration>(controlled)
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
  const hasCodeViewHeader = renderCodeViewHeader != null;
  const hasCodeViewFooter = renderCodeViewFooter != null;
  const emitSelectedLinesChange = useStableCallback(
    (selection: CodeViewLineSelection | null) => {
      onSelectedLinesChange?.(selection);
    }
  );
  const controlledSelection = selectedLines !== undefined;

  // Keep the adapter stable so provider and editor-option changes affect the
  // next item edit session without forcing CodeView to reconcile active editors.
  const createEditor = useStableCallback(
    (
      documentKind: EditorDocumentKind,
      options: CodeViewCreateEditorOptions<LAnnotation>,
      editStateKey?: string
    ): DiffsEditor<LAnnotation> => {
      if (contextCreateEditor == null) {
        throw new Error('CodeView: EditContext is not attached');
      }

      const editor = contextCreateEditor(
        documentKind,
        {
          ...editorOptions,
          ...options,
        },
        editStateKey
      );
      if (editor == null) {
        throw new Error(
          'CodeView: EditProvider.createEditor must return an editor instance'
        );
      }
      return editor;
    }
  );
  const emitItemEditChange = useStableCallback(
    (
      event: EditorChangeEvent<LAnnotation, 'file' | 'diff'>,
      item: CodeViewItem<LAnnotation, LDecoration>
    ) => {
      onItemEditChange?.(event, item);
    }
  );
  const emitItemEditComplete = useStableCallback(
    <TMode extends CodeViewMode>(
      event: CodeViewItemEditCompleteEventMap<LAnnotation>[TMode],
      item: CodeViewModeItemMap<LAnnotation, LDecoration>[TMode],
      nextItem: CodeViewModeItemMap<LAnnotation, LDecoration>[TMode]
    ) => onItemEditComplete?.(event, item, nextItem) ?? 'reject'
  );

  const managedOptions = useMemo(
    () =>
      createManagedCodeViewOptions({
        options,
        hasCustomHeader,
        hasGutterRenderer,
        hasCodeViewHeader,
        hasCodeViewFooter,
        onSelectedLinesChange:
          onSelectedLinesChange != null ? emitSelectedLinesChange : undefined,
        controlledSelection,
        getEditStateKey,
        createEditor: contextCreateEditor != null ? createEditor : undefined,
        onItemEditChange:
          onItemEditChange != null ? emitItemEditChange : undefined,
        onItemEditComplete:
          onItemEditComplete != null ? emitItemEditComplete : undefined,
      }),
    [
      contextCreateEditor,
      controlledSelection,
      createEditor,
      emitItemEditChange,
      emitItemEditComplete,
      emitSelectedLinesChange,
      hasCodeViewFooter,
      hasCodeViewHeader,
      hasCustomHeader,
      hasGutterRenderer,
      getEditStateKey,
      onItemEditChange,
      onItemEditComplete,
      onSelectedLinesChange,
      options,
    ]
  );

  const [slotContentStore] = useState<
    ManagedContentStore<LAnnotation, LDecoration>
  >(() => createSlotContentStore());
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
      cachedDataRef.current = createDefaultCache<LAnnotation, LDecoration>(
        controlled
      );
    }

    // If our node matches the existing node then we should not attempt to
    // setup.  This is a case that should never be possible to hit, but just in
    // case, lets make sure we don't re-setup an instance that is already setup
    // properly
    if (
      node != null &&
      node !== cachedDataRef.current.instance?.getContainerElement()
    ) {
      cachedDataRef.current.instance = new CodeViewClass<
        LAnnotation,
        LDecoration
      >(managedOptions, !disableWorkerPool ? poolManager : undefined, true);
      cachedDataRef.current.instance.setup(node);
    }

    if (typeof containerRef === 'function') {
      containerRef(node);
    } else if (containerRef != null) {
      containerRef.current = node;
    }
  });

  const onSnapshotChange = useStableCallback(
    (snapshot: CodeViewSlotSnapshot<LAnnotation, LDecoration> | undefined) => {
      if (cachedDataRef.current.disableFlushSync) {
        slotContentStore.publish(snapshot);
      } else {
        flushSync(() => {
          slotContentStore.publish(snapshot);
        });
      }
    }
  );

  const slotCoordinator:
    | CodeViewCoordinator<LAnnotation, LDecoration>
    | undefined = useMemo(() => {
    // A coordinator is needed whenever React portals anything — per-item
    // slots and codeview header and footer
    if (
      !hasHeaderRenderers &&
      !hasAnnotationRenderer &&
      !hasGutterRenderer &&
      !hasCodeViewHeader &&
      !hasCodeViewFooter
    ) {
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
    hasCodeViewHeader,
    hasCodeViewFooter,
  ]);

  useIsomorphicLayoutEffect(() => {
    return onScroll != null
      ? cachedDataRef.current.instance?.subscribeToScroll(onScroll)
      : undefined;
  });

  useIsomorphicLayoutEffect(() => {
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
    (): CodeViewHandle<LAnnotation, LDecoration> => ({
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
      removeItem(id) {
        const { controlled, instance } = cachedDataRef.current;
        assertUncontrolledCodeViewAction(controlled, 'removeItem');
        if (instance == null) {
          console.error(
            'CodeView.removeItem: no valid instance to remove item from',
            id
          );
          return false;
        }

        return instance.removeItem(id);
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
      getEditor(id) {
        const { instance } = cachedDataRef.current;
        if (instance == null) {
          console.error('CodeView.getEditor: no valid instance exists', id);
          return undefined;
        }

        return instance.getEditor(id);
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
      {(hasRenderers || hasCodeViewHeader || hasCodeViewFooter) && (
        <SlotPortals<LAnnotation, LDecoration>
          managedContentStore={slotContentStore}
          renderCustomHeader={renderCustomHeader}
          renderHeaderPrefix={renderHeaderPrefix}
          renderHeaderFilenameSuffix={renderHeaderFilenameSuffix}
          renderHeaderMetadata={renderHeaderMetadata}
          renderAnnotation={renderAnnotation}
          renderGutterUtility={renderGutterUtility}
          renderCodeViewHeader={renderCodeViewHeader}
          renderCodeViewFooter={renderCodeViewFooter}
        />
      )}
    </>
  );
}

// React was a mistake
export const CodeView = forwardRef(CodeViewInner) as CodeViewComponent;

function isAppendOnlyItemUpdate<LAnnotation, LDecoration>(
  previousItems: readonly CodeViewItem<LAnnotation, LDecoration>[] | undefined,
  nextItems: readonly CodeViewItem<LAnnotation, LDecoration>[]
): previousItems is readonly CodeViewItem<LAnnotation, LDecoration>[] {
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

function areItemListsEqual<LAnnotation, LDecoration>(
  previousItems: readonly CodeViewItem<LAnnotation, LDecoration>[] | undefined,
  nextItems: readonly CodeViewItem<LAnnotation, LDecoration>[]
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
  LDecoration,
>(): ManagedContentStore<LAnnotation, LDecoration> {
  let snapshot: CodeViewSlotSnapshot<LAnnotation, LDecoration> | undefined;
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

interface CreateManagedCodeViewOptionsProps<LAnnotation, LDecoration> {
  options: CodeViewReactOptions<LAnnotation, LDecoration> | undefined;
  hasCustomHeader: boolean;
  hasGutterRenderer: boolean;
  hasCodeViewHeader: boolean;
  hasCodeViewFooter: boolean;
  onSelectedLinesChange?(selection: CodeViewLineSelection | null): void;
  controlledSelection: boolean;
  getEditStateKey: CodeViewOptions<
    LAnnotation,
    LDecoration
  >['getEditStateKey'];
  createEditor: CodeViewOptions<LAnnotation, LDecoration>['createEditor'];
  onItemEditChange: CodeViewOptions<
    LAnnotation,
    LDecoration
  >['onItemEditChange'];
  onItemEditComplete: CodeViewOptions<
    LAnnotation,
    LDecoration
  >['onItemEditComplete'];
}

function createManagedCodeViewOptions<LAnnotation, LDecoration>({
  options,
  hasCustomHeader,
  hasGutterRenderer,
  hasCodeViewHeader,
  hasCodeViewFooter,
  onSelectedLinesChange,
  controlledSelection,
  getEditStateKey,
  createEditor,
  onItemEditChange,
  onItemEditComplete,
}: CreateManagedCodeViewOptionsProps<
  LAnnotation,
  LDecoration
>): CodeViewOptions<LAnnotation, LDecoration> {
  const managedOptions: CodeViewOptions<LAnnotation, LDecoration> = {
    ...options,
    controlledSelection,
    onSelectedLinesChange,
    createEditor,
  };

  if (getEditStateKey != null) {
    managedOptions.getEditStateKey = getEditStateKey;
  }

  // Prop-level editor callbacks win over their options-object counterparts,
  // but an absent prop must not clobber a value provided via `options`.
  if (onItemEditChange != null) {
    managedOptions.onItemEditChange = onItemEditChange;
  }
  if (onItemEditComplete != null) {
    managedOptions.onItemEditComplete = onItemEditComplete;
  }

  // The imperative CodeView adapters use this callback's presence to
  // switch file and diff headers into custom-slot mode. React portals
  // provide the actual header content, so this placeholder
  // intentionally returns nothing.
  if (hasCustomHeader) {
    managedOptions.renderCustomHeader = noopRender;
  }

  // The imperative CodeView adapters use this callback's presence to
  // create the custom gutter utility slot. React portals provide the
  // actual content, so this placeholder intentionally returns nothing.
  if (hasGutterRenderer) {
    managedOptions.renderGutterUtility = noopRender;
  }

  // The imperative CodeView adapters use these callbacks' presence to create the
  // header/footer host elements. React portals the actual content into them (via
  // the slot snapshot), so these placeholders intentionally return nothing.
  if (hasCodeViewHeader) {
    managedOptions.renderCodeViewHeader = noopRender;
  }
  if (hasCodeViewFooter) {
    managedOptions.renderCodeViewFooter = noopRender;
  }

  return managedOptions;
}

interface RenderCodeViewItemChildrenProps<LAnnotation, LDecoration> {
  renderedItem: CodeViewRenderedItem<LAnnotation, LDecoration>;
  renderCustomHeader: CodeViewBaseProps<
    LAnnotation,
    LDecoration
  >['renderCustomHeader'];
  renderHeaderPrefix: CodeViewBaseProps<
    LAnnotation,
    LDecoration
  >['renderHeaderPrefix'];
  renderHeaderFilenameSuffix: CodeViewBaseProps<
    LAnnotation,
    LDecoration
  >['renderHeaderFilenameSuffix'];
  renderHeaderMetadata: CodeViewBaseProps<
    LAnnotation,
    LDecoration
  >['renderHeaderMetadata'];
  renderAnnotation: CodeViewBaseProps<
    LAnnotation,
    LDecoration
  >['renderAnnotation'];
  renderGutterUtility: CodeViewBaseProps<
    LAnnotation,
    LDecoration
  >['renderGutterUtility'];
}

interface SlotPortalsProps<LAnnotation, LDecoration> {
  managedContentStore: ManagedContentStore<LAnnotation, LDecoration>;
  renderCustomHeader: CodeViewBaseProps<
    LAnnotation,
    LDecoration
  >['renderCustomHeader'];
  renderHeaderPrefix: CodeViewBaseProps<
    LAnnotation,
    LDecoration
  >['renderHeaderPrefix'];
  renderHeaderFilenameSuffix: CodeViewBaseProps<
    LAnnotation,
    LDecoration
  >['renderHeaderFilenameSuffix'];
  renderHeaderMetadata: CodeViewBaseProps<
    LAnnotation,
    LDecoration
  >['renderHeaderMetadata'];
  renderAnnotation: CodeViewBaseProps<
    LAnnotation,
    LDecoration
  >['renderAnnotation'];
  renderGutterUtility: CodeViewBaseProps<
    LAnnotation,
    LDecoration
  >['renderGutterUtility'];
  renderCodeViewHeader: CodeViewBaseProps<
    LAnnotation,
    LDecoration
  >['renderCodeViewHeader'];
  renderCodeViewFooter: CodeViewBaseProps<
    LAnnotation,
    LDecoration
  >['renderCodeViewFooter'];
}

const SlotPortals = memo(function SlotPortals<LAnnotation, LDecoration>({
  managedContentStore,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  renderAnnotation,
  renderGutterUtility,
  renderCodeViewHeader,
  renderCodeViewFooter,
}: SlotPortalsProps<LAnnotation, LDecoration>) {
  'use no memo';
  const subscribe = useStableCallback((listener: () => void) =>
    managedContentStore.subscribe(listener)
  );
  const getSnapshot = useStableCallback(() =>
    managedContentStore.getSnapshot()
  );
  const snapshot = useSyncExternalStore<
    CodeViewSlotSnapshot<LAnnotation, LDecoration> | undefined
  >(subscribe, getSnapshot, getSnapshot);
  let itemKeys = '';
  for (const item of snapshot?.items ?? []) {
    itemKeys += `${item.id}:${item.version}:${item.type}`;
  }
  // NOTE(amadeus): And just like that, the react compiler do be failing us
  // lol... we need to pre-render everything for items, headers and footers to
  // not trigger needless renders while scrolling
  const renderedItems = useMemo(
    () => {
      return snapshot?.items?.map((renderedItem) =>
        createPortal(
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
        )
      );
    },
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [
      renderCustomHeader,
      renderHeaderPrefix,
      renderHeaderFilenameSuffix,
      renderHeaderMetadata,
      renderAnnotation,
      renderGutterUtility,
      itemKeys,
    ]
  );
  const renderedHeader = useMemo(() => {
    return renderCodeViewHeader != null && snapshot?.header != null
      ? createPortal(renderCodeViewHeader(), snapshot.header)
      : null;
  }, [renderCodeViewHeader, snapshot?.header]);
  const renderedFooter = useMemo(() => {
    return renderCodeViewFooter != null && snapshot?.footer != null
      ? createPortal(renderCodeViewFooter(), snapshot.footer)
      : null;
  }, [renderCodeViewFooter, snapshot?.footer]);
  return (
    <>
      {renderedItems}
      {renderedHeader}
      {renderedFooter}
    </>
  );
}) as SlotPortalsComponent;

function renderCodeViewItemChildren<LAnnotation, LDecoration>({
  renderedItem,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  renderAnnotation,
  renderGutterUtility,
}: RenderCodeViewItemChildrenProps<LAnnotation, LDecoration>): ReactNode {
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
      getAnnotationSlotName: instance.getAnnotationSlotName,
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
      getAnnotationSlotName: instance.getAnnotationSlotName,
    });
  }
}

function noopRender() {
  return undefined;
}
