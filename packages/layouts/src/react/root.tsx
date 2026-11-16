'use client';

// `Root`: the pane hosts of a layout, flat and keyed by pane ID, with the CSS
// geometry, the separators and their resize gestures (pointer and keys),
// collapse, hidden panes, and the focus of a pane. Features add the rest
// through the hooks of the contract, and parts in the output of `renderPane`
// render the pane chrome.
import {
  type CSSProperties,
  type HTMLAttributes,
  type JSX,
  memo,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  computeCSSLayout,
  type CSSLayout,
  type CSSPane,
  type PaneEdges,
} from '../css-layout';
import splitCss from '../css/split.css?inline';
import { readPixelGeometry } from '../dom/panes';
import {
  COLLAPSED,
  COLLAPSED_WHOLE,
  createPaneVisibility,
  HIDDEN,
  HOST_HIDDEN,
  INACTIVE,
  registerVisibility,
  STATE_REASONS,
} from '../dom/visibility';
import { dragSizes, keySizes } from '../gestures';
import type { LayoutChange, LayoutOperation } from '../layout-operation';
import { collapsedSizeOf, getPanes, shownPanes } from '../model';
import { presentation } from '../presentation';
import { startResizeGesture } from '../resize-gesture';
import type {
  ChildSize,
  Direction,
  LayoutGeometry,
  LayoutNode,
  LayoutState,
  PaneNode,
  SeparatorGeometry,
} from '../types';
import {
  type AnnounceContext,
  type Feature,
  type FeatureHooks,
  type Gesture,
  type LayoutMessages,
  PaneContext,
  type PaneContextValue,
  paneIdOf,
  type PaneMessageValues,
  type SeparatorMessageValues,
  Style,
  type StylesheetsSetting,
  type ViewContext,
  type ViewRender,
  type ViewState,
  type ViewStore,
} from './contract';
import type { LayoutObject } from './create-layout';
import { separatorGestureStyle } from './gesture-styles';
import { registerLayoutElement } from './layout-elements';
import { paneLayers } from './pane-layers';

/** A separator, for `getSeparatorProps`. */
export interface LayoutSeparator {
  /** The ID of the separator. */
  readonly id: string;
  /** The ID of the split of the separator. */
  readonly splitId: string;
  /** The index in the children of the split of the child after the separator. */
  readonly index: number;
  readonly direction: Direction;
  /** The panes that show before the separator, which it resizes first. */
  readonly before: readonly PaneNode[];
  /** The panes that show after the separator, which it resizes first. */
  readonly after: readonly PaneNode[];
}

/** Props of `Root`. */
export interface RootProps {
  /**
   * The layout: a layout object from `createLayout`, or from
   * `useControlledLayout` for a tree that the app owns.
   */
  layout: LayoutObject;
  /**
   * The content of a pane, with its chrome: parts such as `Layout.Header`
   * and `Layout.Content`, and app components that call `Layout.usePane`,
   * read the pane from context.
   *
   * Keep the identity of this function, for example with `useCallback`: the
   * content of every pane renders again when it changes. It also renders
   * again when its pane node changes, except for a change of `hidden`,
   * `collapsed`, or `collapsedSize` alone: the content of a pane that hides,
   * shows, collapses, or expands does not render, and receives
   * `PANE_VISIBILITY_EVENT` instead. In development, `Root` warns when this
   * function changes while the tree does not.
   */
  renderPane: (pane: PaneNode) => ReactNode;
  getPaneTitle?: (pane: PaneNode) => string;
  /**
   * Report the sizes of each local `resize` operation: a pointer release, a
   * key press on a separator, or a call of `layout.setSizes`. A cancelled
   * drag reports nothing.
   */
  onResize?: (sizes: Readonly<Record<string, readonly ChildSize[]>>) => void;
  /**
   * Called by `Layout.CloseButton` and by Delete on a tab, in place of
   * `layout.close`, for example to hide the pane so that it keeps its content.
   */
  onPaneClose?: (pane: PaneNode) => void;
  /**
   * Extra props of each pane host: classes and `data-*` attributes. The
   * view's own attributes take precedence.
   */
  getPaneProps?: (pane: PaneNode) => { className?: string } & {
    [Attribute in `data-${string}`]?: string | boolean | undefined;
  };
  /**
   * Extra props of each separator: classes, children such as a larger hit
   * area, an accessible label, `hidden`, and a double-click handler.
   */
  getSeparatorProps?: (
    separator: LayoutSeparator
  ) => Pick<
    HTMLAttributes<HTMLDivElement>,
    'className' | 'children' | 'onDoubleClick' | 'aria-label' | 'hidden'
  >;
  /**
   * The sheets of the layout. By default, `Root`, its features, and its parts
   * render the sheets that they use, once per document. `{ nonce }` gives
   * each sheet a nonce for a content security policy. `null` renders no
   * sheet: the app links `styles.css`.
   */
  stylesheets?: { nonce?: string } | null;
  /** The strings of the layout, its controls, and its announcements. */
  messages?: LayoutMessages;
  className?: string;
  style?: CSSProperties;
  gap?: number;
}

const defaultTitle = (pane: PaneNode): string => pane.id;

const NO_MESSAGES: LayoutMessages = {};

const separatorName = ({
  beforeTitles,
  afterTitles,
}: SeparatorMessageValues): string =>
  `Resize ${beforeTitles} and ${afterTitles}`;

const separatorValue = ({ percent }: { percent: number }): string =>
  `${percent}% preferred position`;

const paneCount = ({ count }: { count: number }): string => `${count} panes`;

const collapsedText = ({ paneTitle }: PaneMessageValues): string =>
  `${paneTitle} collapsed`;
const expandedText = ({ paneTitle }: PaneMessageValues): string =>
  `${paneTitle} expanded`;

/**
 * The announcement of a local change: the text of its last operation that has
 * one. `Root` gives the collapse and the expand; each feature gives the text
 * of its own operations.
 */
function announcementOf(
  change: LayoutChange,
  previous: LayoutState,
  next: LayoutState,
  features: readonly Feature[],
  latest: LatestProps
): string | null {
  const messages = latest.messages ?? NO_MESSAGES;
  // The title of a pane after the change, or before it for a pane that closes.
  const title = (id: string): string => {
    const pane = [...getPanes(next.root), ...getPanes(previous.root)].find(
      (each) => each.id === id
    );
    return pane === undefined ? id : latest.getPaneTitle(pane);
  };
  const context: AnnounceContext = {
    previous,
    next,
    messages,
    title,
    pane: (id) => ({ paneTitle: title(id), paneId: id }),
    target: (id) => ({ targetTitle: title(id), targetId: id }),
  };
  const textOf = (operation: LayoutOperation): string | null | undefined =>
    operation.type === 'collapse'
      ? (operation.collapsed
          ? (messages.collapsed ?? collapsedText)
          : (messages.expanded ?? expandedText))(context.pane(operation.pane))
      : features
          .map((feature) => feature.announce?.(operation, context))
          .find((text) => text != null);
  let text: string | null = null;
  for (const operation of change.operations) text = textOf(operation) ?? text;
  return text;
}

/** The reasons from the layout state that a pane does not show all its content. */
function stateReasons(
  { pane, stack, hidden, collapsed }: CSSPane,
  filled: string | null
): number {
  const inactive = stack !== null && stack.active !== pane.id;
  // A pane that fills the layout shows its content, also when it is collapsed.
  const folded = collapsed && filled !== pane.id;
  return (
    (inactive ? INACTIVE : hidden ? HIDDEN : 0) |
    (folded
      ? COLLAPSED | (collapsedSizeOf(stack ?? pane) === 0 ? COLLAPSED_WHOLE : 0)
      : 0)
  );
}

let warnedRenderPane = false;

const warnedSlots = new Set<string>();

/** In development, warn once when two features fill a slot that one feature fills. */
function warnSlot(slot: string): void {
  if (!warnedSlots.has(slot)) {
    warnedSlots.add(slot);
    console.warn(
      `@pierre/layouts: two features fill ${slot}; the feature whose name comes last wins.`
    );
  }
}

/**
 * In development, warn once when `renderPane` changes while the tree does
 * not: the content of each pane then renders again for no change of its own.
 */
function useRenderPaneCheck(
  renderPane: RootProps['renderPane'],
  root: LayoutNode
): void {
  const last = useRef({ renderPane, root });
  useEffect(() => {
    const before = last.current;
    last.current = { renderPane, root };
    if (
      !warnedRenderPane &&
      before.renderPane !== renderPane &&
      before.root === root
    ) {
      warnedRenderPane = true;
      console.warn(
        '@pierre/layouts: renderPane changed while the tree did not, so the content of each pane rendered again. Keep the identity of renderPane, and read the state of a pane with Layout.usePane.'
      );
    }
  });
}

const EDGE_ORDER = ['top', 'right', 'bottom', 'left'] as const;

const edgeList = (edges: PaneEdges): string =>
  EDGE_ORDER.filter((edge) => edges[edge]).join(' ');

/** The class of an element of the view, with an app's classes after it. */
const withClasses = (own: string, app: string | undefined): string =>
  app === undefined || app === '' ? own : `${own} ${app}`;

// The compiled CSS of each tree, by gap. A view reads it for each render and
// before a change, so it is computed once for each tree.
const cssLayouts = new WeakMap<LayoutNode, Map<number, CSSLayout>>();

function cssLayoutOf(root: LayoutNode, gap: number): CSSLayout {
  let byGap = cssLayouts.get(root);
  if (byGap === undefined) {
    byGap = new Map();
    cssLayouts.set(root, byGap);
  }
  let layout = byGap.get(gap);
  if (layout === undefined) {
    layout = computeCSSLayout(root, gap);
    byGap.set(gap, layout);
  }
  return layout;
}

/** A small external store for the state of the view, such as a drag. */
function createViewState(): ViewState {
  let state: Readonly<Record<string, unknown>> = {};
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

interface PaneBodyProps {
  pane: PaneNode;
  renderPane: (pane: PaneNode) => ReactNode;
  value: PaneContextValue;
}

// Properties of a pane node that change where and whether its content shows,
// not the content. A hide, a show, a collapse, or an expand replaces the pane
// node with a copy that differs only in these.
const LAYOUT_ONLY_KEYS = new Set<string>([
  'hidden',
  'collapsed',
  'collapsedSize',
]);

/**
 * True when a pane's content can keep its last render: the same `renderPane`
 * and pane context, and a pane node that is the same, or differs only in
 * `LAYOUT_ONLY_KEYS`.
 */
function sameContentProps(a: PaneBodyProps, b: PaneBodyProps): boolean {
  if (a.renderPane !== b.renderPane || a.value !== b.value) return false;
  if (a.pane === b.pane) return true;
  const keys = (pane: PaneNode): string[] =>
    Object.keys(pane).filter((key) => !LAYOUT_ONLY_KEYS.has(key));
  const before = keys(a.pane);
  const record = (pane: PaneNode) => pane as unknown as Record<string, unknown>;
  return (
    before.length === keys(b.pane).length &&
    before.every((key) => record(a.pane)[key] === record(b.pane)[key])
  );
}

/**
 * The app's content of one pane, with its pane context. It renders only when
 * its pane node or the app's `renderPane` changes: parts inside it subscribe
 * to the state that they show, so a focus, zoom, or tab change renders the
 * parts and not the content. `Root` adds no wrapper: `Layout.Content` is the
 * scroll area of an app that has a header.
 */
const PaneBody = /* @__PURE__ */ memo(function PaneBody({
  pane,
  renderPane,
  value,
}: PaneBodyProps): JSX.Element {
  return <PaneContext value={value}>{renderPane(pane)}</PaneContext>;
}, sameContentProps);

/** The props of `Root` that its context reads after a render. */
interface LatestProps {
  gap: number;
  getPaneTitle: (pane: PaneNode) => string;
  onResize: RootProps['onResize'];
  onPaneClose: RootProps['onPaneClose'];
  stylesheets: StylesheetsSetting;
  messages: LayoutMessages | undefined;
}

// In development, the pane contexts of each view, for the tests of
// `forgetPanes`.
const developmentPaneContexts = /* @__PURE__ */ new WeakMap<
  ViewContext,
  ReadonlyMap<string, PaneContextValue>
>();

/**
 * The IDs of the panes that a view keeps a pane context for. Tests read it in
 * a development build; in a production build it is empty.
 */
export function paneContextIds(context: ViewContext): Set<string> {
  return new Set(developmentPaneContexts.get(context)?.keys());
}

/** The internal parts of a view: its context, and what `Root` calls. */
interface ViewInternals {
  context: ViewContext;
  /** The callback ref of the layout element. */
  setElement(element: HTMLDivElement | null): void;
  /** Take the props of a committed render, for the context. */
  setLatest(latest: LatestProps): void;
  /** Take the hooks of a committed render, for parts and store changes. */
  setHooks(hooks: readonly FeatureHooks[]): void;
  /**
   * Take a store change, before React renders it: run the hooks, report the
   * resizes and announce a local change, and end a gesture at a remote one.
   */
  beforeChange(
    previous: LayoutState,
    next: LayoutState,
    change: LayoutChange
  ): void;
  /** The pointer move of the current gesture. */
  move(event: PointerEvent<HTMLElement>): void;
  /** End the current gesture, or the gesture of a pointer. */
  finish(cancel: boolean, pointerId?: number): void;
  /** True during a gesture. */
  gesturing(): boolean;
  /**
   * The context of a pane, the same object while the pane is in the tree, so
   * that the content of a pane does not render again for a new context.
   */
  paneContext(id: string): PaneContextValue;
  /**
   * Drop the entries of the panes that left the tree from each cache that
   * keeps an entry for each pane: the pane contexts (and with them the
   * stores of `usePane`) and the visibility module.
   */
  forgetPanes(panes: ReadonlySet<string>): void;
}

/**
 * The context of a view and its mutable state: the layout element, the
 * latest props, the hooks of the last render, the current gesture, and the
 * change count. The state lives in this closure, outside the renders of
 * `Root`, which reads it only in callbacks and effects.
 */
function createViewInternals(
  store: ViewStore,
  prefix: string,
  features: readonly Feature[],
  initial: LatestProps,
  setResizing: (resizing: boolean) => void,
  announce: (text: string) => void
): ViewInternals {
  let element: HTMLDivElement | null = null;
  let latest = initial;
  let hooks: readonly FeatureHooks[] = [];
  let gesture: Gesture | null = null;
  let resizing = false;
  let changes = 0;
  const paneContexts = new Map<string, PaneContextValue>();
  const readGeometry = (): LayoutGeometry =>
    element === null
      ? { panes: [], separators: [] }
      : readPixelGeometry(element, store.getSnapshot().root, latest.gap);
  const separatorsOf = (ids: readonly string[]): SeparatorGeometry[] =>
    readGeometry().separators.filter(({ id }) => ids.includes(id));
  const finish = (cancel: boolean, pointerId?: number): void => {
    const active = gesture;
    if (
      active === null ||
      (pointerId !== undefined && active.pointerId !== pointerId)
    )
      return;
    // Before the end, so that the `lostpointercapture` of a release finds
    // no gesture to cancel.
    gesture = null;
    active.end(cancel);
  };
  const names = new Set(features.map((feature) => feature.name));
  const context: ViewContext = {
    store,
    prefix,
    view: createViewState(),
    visibility: createPaneVisibility(),
    element: () => element,
    cssLayoutOf: (root) => cssLayoutOf(root, latest.gap),
    readGeometry,
    change: () => changes,
    startGesture(next) {
      gesture = next;
    },
    resizing: () => resizing,
    startResize(event, ids) {
      const separators = separatorsOf(ids);
      if (event.button !== 0) return;
      const target = event.currentTarget;
      const pointerId = event.pointerId;
      event.preventDefault();
      target.focus();
      target.setPointerCapture(pointerId);
      const x = event.clientX;
      const y = event.clientY;
      // The sizes of each move are transient; the end gives one operation.
      const sizes = startResizeGesture(
        store,
        separators.map(({ split }) => split.id)
      );
      // A feature can apply the sizes of each move in place of the store.
      const strategy = hooks.findLast((hook) => hook.applySizes !== undefined);
      resizing = true;
      gesture = {
        pointerId,
        move(move) {
          if (element === null) return;
          const proposed = dragSizes(
            separators,
            move.clientX - x,
            move.clientY - y
          );
          if (strategy?.applySizes !== undefined)
            strategy.applySizes(element, separators, proposed);
          else sizes.move(proposed);
        },
        end(cancel) {
          // A strategy that defers its sizes applies them while the resize
          // still holds, so that they do not animate.
          strategy?.endResize?.(cancel);
          if (target.hasPointerCapture?.(pointerId))
            target.releasePointerCapture(pointerId);
          sizes.end(cancel);
          resizing = false;
          setResizing(false);
        },
      };
      setResizing(true);
    },
    // A key press that resizes is a whole resize: one `resize` operation.
    // The key does not reach the app's own key handlers above the layout.
    resizeKey(event, ids) {
      const proposed = keySizes(separatorsOf(ids), event.key, event.shiftKey);
      if (proposed === null) return;
      event.preventDefault();
      event.stopPropagation();
      store.setSizes(proposed);
    },
    title: (pane) => latest.getPaneTitle(pane),
    onPaneClose: () => latest.onPaneClose,
    hooks: () => hooks,
    has: (name) => names.has(name),
    stylesheets: () => latest.stylesheets,
    messages: () => latest.messages ?? NO_MESSAGES,
  };
  if (process.env.NODE_ENV !== 'production')
    developmentPaneContexts.set(context, paneContexts);
  return {
    context,
    setElement(next) {
      if (element !== null) registerVisibility(element, null);
      element = next;
      if (element !== null) registerVisibility(element, context.visibility);
      registerLayoutElement(store, element);
    },
    setLatest(next) {
      latest = next;
    },
    setHooks(next) {
      hooks = next;
    },
    beforeChange(previous, next, change) {
      changes += 1;
      if (element !== null)
        for (const hook of hooks)
          hook.beforeChange?.(previous, next, element, change);
      // A remote change ends a gesture with no operation: the store applied
      // it to the state from before the gesture.
      if (change.origin === 'remote') finish(true);
      else {
        for (const operation of change.operations)
          if (operation.type === 'resize') latest.onResize?.(operation.sizes);
        const text = announcementOf(change, previous, next, features, latest);
        if (text !== null) announce(text);
      }
    },
    move(event) {
      if (gesture !== null && gesture.pointerId === event.pointerId)
        gesture.move(event);
    },
    finish,
    gesturing: () => gesture !== null,
    paneContext(id) {
      let value = paneContexts.get(id);
      if (value === undefined) {
        value = { id, context };
        paneContexts.set(id, value);
      }
      return value;
    },
    forgetPanes(panes) {
      for (const id of paneContexts.keys())
        if (!panes.has(id)) paneContexts.delete(id);
      context.visibility.forget(panes);
    },
  };
}

/** The layout, with flat pane hosts that keep their content while the tree changes. */
export function Root(props: RootProps): JSX.Element {
  const {
    renderPane,
    getPaneTitle = defaultTitle,
    onResize,
    onPaneClose,
    getPaneProps,
    getSeparatorProps,
    stylesheets,
    messages,
    className,
    style,
    gap = 8,
  } = props;
  const store: ViewStore = props.layout;
  // The features of the first render, in the order of their names: the view
  // part of each is a hook, and a slot that one feature fills goes to the
  // same feature in any order of the list.
  const [features] = useState(() =>
    [...store.features].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    )
  );
  const [resizing, setResizing] = useState(false);
  // The announcement of the last local change. A new key gives the live
  // region a new element, so that it speaks the same text again.
  const [message, setMessage] = useState<{ text: string; key: number } | null>(
    null
  );
  const prefix = useId();
  // The props that the context reads, from the last committed render. The
  // first render reads its own props.
  const latestProps: LatestProps = {
    gap,
    getPaneTitle,
    onResize,
    onPaneClose,
    stylesheets,
    messages,
  };
  const internals = useMemo(
    () =>
      createViewInternals(
        store,
        prefix,
        features,
        latestProps,
        setResizing,
        (text) => setMessage((last) => ({ text, key: (last?.key ?? 0) + 1 }))
      ),
    // The latest props reach the context through `setLatest`.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [store, prefix, features]
  );
  useLayoutEffect(() => {
    internals.setLatest(latestProps);
  });
  const { context, finish } = internals;

  // The hooks of the features see each store change before React renders
  // it, while the layout's boxes are clean.
  const subscribe = useMemo(
    () =>
      (listener: () => void): (() => void) => {
        let previous = store.getSnapshot();
        return store.subscribe((change) => {
          const next = store.getSnapshot();
          internals.beforeChange(previous, next, change);
          previous = next;
          listener();
        });
      },
    [store, internals]
  );
  const state = useSyncExternalStore(
    subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  // The store keeps the tree on focus and zoom changes, so this runs only when
  // the tree or the gap changes.
  const geometry = useMemo(
    () => cssLayoutOf(state.root, gap),
    [state.root, gap]
  );
  // The condition is the same for each render of a build.
  if (process.env.NODE_ENV !== 'production')
    // oxlint-disable-next-line react-hooks/rules-of-hooks
    useRenderPaneCheck(renderPane, state.root);
  const visibleCount = geometry.panes.filter(({ hidden }) => !hidden).length;
  const render: ViewRender = { state, geometry, gap, visibleCount };
  const hooks: FeatureHooks[] = [];
  for (const feature of features)
    if (feature.use !== undefined) hooks.push(feature.use(context, render));
  if (
    process.env.NODE_ENV !== 'production' &&
    hooks.filter((hook) => hook.applySizes !== undefined).length > 1
  )
    warnSlot('applySizes');
  // Parts and the store subscription read the hooks outside a render, after
  // this commit. This effect comes before the effects that run the hooks.
  useLayoutEffect(() => {
    internals.setHooks(hooks);
  });

  const { filled } = presentation(state);
  // The visibility of each host in the first render, which a server renders
  // too. After it, the visibility module writes the visibility: React renders
  // these same values again, so it does not write them.
  const [firstReasons] = useState(
    () =>
      new Map(
        geometry.panes.map((host) => [host.pane.id, stateReasons(host, filled)])
      )
  );
  // Give the visibility module the reasons from the state: a hide or a show,
  // a change of tab, or a collapse. It writes the hosts whose reasons change,
  // and tells the content that starts or stops rendering. The content stays
  // mounted, so it can pause its own work. Then the caches of the view
  // forget the panes that left the tree.
  useLayoutEffect(() => {
    const panes = new Set<string>();
    for (const host of geometry.panes) {
      panes.add(host.pane.id);
      context.visibility.set(
        host.pane.id,
        STATE_REASONS,
        stateReasons(host, filled)
      );
    }
    internals.forgetPanes(panes);
  }, [geometry, filled, context, internals]);

  // After React commits a state, before the browser paints.
  const committed = useRef<LayoutState | null>(null);
  useLayoutEffect(() => {
    const element = context.element();
    const previous = committed.current;
    committed.current = state;
    if (element !== null)
      for (const hook of context.hooks())
        hook.afterChange?.(previous, state, element);
  }, [state, context]);

  // A window that loses the focus during a pointer resize, for example to
  // another app, may never send the pointer release. The resize then applies
  // its current sizes and ends.
  useEffect(() => {
    if (!resizing) return;
    const end = () => finish(false);
    window.addEventListener('blur', end);
    return () => window.removeEventListener('blur', end);
  }, [resizing, finish]);

  // An unmount during a gesture cancels it: a resize restores the sizes from
  // before it.
  useEffect(() => () => finish(true), [finish]);

  useEffect(() => {
    const element = context.element();
    if (element === null) return;
    // No text selection during a gesture. An inherited style on the root,
    // such as user-select, would recalculate the style of all pane content.
    const preventSelection = (event: Event): void => {
      if (internals.gesturing()) event.preventDefault();
    };
    element.addEventListener('selectstart', preventSelection);
    return () => element.removeEventListener('selectstart', preventSelection);
  }, [context, internals]);

  // Keep the DOM order independent of the tree: a detach and reinsert can
  // reset scroll and focus.
  const paneHosts = useMemo(
    () =>
      [...geometry.panes].sort((a, b) =>
        a.pane.id < b.pane.id ? -1 : a.pane.id > b.pane.id ? 1 : 0
      ),
    [geometry]
  );
  // Style objects keep their identity while the tree does, so a focus or zoom
  // change gives React the same objects to compare.
  const separatorStyles = useMemo(
    () =>
      new Map(
        geometry.separators.map(
          ({ id, rect, split }): [string, CSSProperties] => [
            id,
            { ...rect, ...separatorGestureStyle(split.direction) },
          ]
        )
      ),
    [geometry]
  );
  const showSeparators = hooks.every((hook) => hook.separators !== false);
  const layers = paneLayers();
  const layered =
    typeof layers === 'boolean' ? layers : visibleCount >= layers.minPanes;
  const status =
    hooks.find((hook) => hook.status != null)?.status ??
    message?.text ??
    (messages?.paneCount ?? paneCount)({ count: visibleCount });
  const sheets = new Map<string, string>([['split', splitCss]]);
  for (const feature of features)
    for (const [name, css] of feature.stylesheets ?? []) sheets.set(name, css);

  return (
    <div
      ref={internals.setElement}
      className={withClasses('pierre-layouts', className)}
      style={style}
      role="group"
      aria-label={messages?.layout ?? 'Workspace'}
      data-resizing={resizing}
      data-pane-layers={layered}
      onPointerMove={internals.move}
      onPointerUp={(event) => finish(false, event.pointerId)}
      onPointerCancel={(event) => finish(true, event.pointerId)}
      onLostPointerCapture={(event) => finish(true, event.pointerId)}
      onKeyDown={(event) => {
        // Pane content that handles a key, for example Escape in a menu,
        // prevents its default, and the layout then leaves the key alone.
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') finish(true);
        for (const hook of hooks) hook.keys?.[event.key]?.(event);
      }}
    >
      {[...sheets].map(([name, css]) => (
        <Style key={name} name={name} css={css} settings={stylesheets} />
      ))}
      {paneHosts.map((host) => {
        const { pane, edges } = host;
        const custom = getPaneProps?.(pane);
        let hostStyle: CSSProperties | undefined;
        const attributes: Record<string, string | boolean | undefined> = {
          'aria-label': getPaneTitle(pane),
          'data-edges': edgeList(edges),
        };
        for (const hook of hooks) {
          const patch = hook.host?.(host);
          if (patch === undefined) continue;
          if (patch.attributes !== undefined)
            Object.assign(attributes, patch.attributes);
          if (patch.style !== undefined) {
            if (
              process.env.NODE_ENV !== 'production' &&
              hostStyle !== undefined
            )
              warnSlot('the style of a pane host');
            hostStyle = patch.style;
          }
        }
        const first = firstReasons.get(pane.id) ?? 0;
        return (
          <section
            key={pane.id}
            // First, so that the view's own attributes below take precedence.
            {...custom}
            {...attributes}
            ref={context.visibility.hostRef(pane.id)}
            id={paneIdOf(prefix, pane.id)}
            data-layouts-pane={pane.id}
            data-layouts-flip={`pane:${pane.id}`}
            className={withClasses('pierre-layouts-pane', custom?.className)}
            // An inert host, which does not show, is not in the tab order.
            tabIndex={0}
            inert={(first & HOST_HIDDEN) !== 0}
            data-hidden={(first & HOST_HIDDEN) !== 0 || undefined}
            data-collapsed={(first & COLLAPSED) !== 0 || undefined}
            data-focused={state.focusedPane === pane.id}
            style={hostStyle ?? host.rect}
            onFocusCapture={() => store.focusPane(pane.id)}
            onPointerDown={() => store.focusPane(pane.id)}
          >
            {/* The inner wrapper counters the host's FLIP scale to preserve the content's shape. */}
            <div className="pierre-layouts-pane-inner">
              <PaneBody
                pane={pane}
                renderPane={renderPane}
                value={internals.paneContext(pane.id)}
              />
            </div>
          </section>
        );
      })}
      {showSeparators &&
        geometry.separators.map((separator) => {
          const { id, split, index } = separator;
          // The separator resizes the two children beside it first.
          const before = shownPanes(separator.before);
          const after = shownPanes(split.children[index]);
          const custom = getSeparatorProps?.({
            id,
            splitId: split.id,
            index,
            direction: split.direction,
            before,
            after,
          });
          const value = Math.round(separator.value * 100);
          return (
            <div
              key={id}
              {...custom}
              className={withClasses(
                'pierre-layouts-separator',
                custom?.className
              )}
              role="separator"
              tabIndex={0}
              aria-label={
                custom?.['aria-label'] ??
                (messages?.separator ?? separatorName)({
                  beforeTitles: before.map(getPaneTitle).join(', '),
                  afterTitles: after.map(getPaneTitle).join(', '),
                  beforeCount: before.length,
                  afterCount: after.length,
                  beforeId: before[0]?.id ?? '',
                  afterId: after[0]?.id ?? '',
                })
              }
              aria-orientation={
                split.direction === 'horizontal' ? 'vertical' : 'horizontal'
              }
              aria-controls={[...before, ...after]
                .map((pane) => paneIdOf(prefix, pane.id))
                .join(' ')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={value}
              aria-valuetext={(messages?.separatorValue ?? separatorValue)({
                percent: value,
              })}
              data-direction={split.direction}
              data-layouts-flip={`separator:${id}`}
              style={separatorStyles.get(id)}
              onPointerDown={(event) => context.startResize(event, [id])}
              onKeyDown={(event) => context.resizeKey(event, [id])}
            />
          );
        })}
      {hooks.map((hook, index) =>
        hook.layers === undefined ? null : <Layers key={index} hook={hook} />
      )}
      <span className="pierre-layouts-sr" role="status" aria-live="polite">
        <span key={message?.key}>{status}</span>
      </span>
    </div>
  );
}

/** The elements that a feature renders after the separators. */
function Layers({ hook }: { hook: FeatureHooks }): ReactNode {
  return hook.layers?.() ?? null;
}
