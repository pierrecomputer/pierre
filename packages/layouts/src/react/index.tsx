'use client';

import {
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  memo,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { computeCSSLayout, type CSSLayout } from '../css-layout';
import {
  animateFromBoxes,
  cancelFlipAnimations,
  finishFlipAnimations,
  readBoxes,
} from '../dom/flip';
import {
  focusPane,
  focusTab,
  focusZoomedPane,
  hideCoveredAfterAnimation,
  notifyHidden,
  readPixelGeometry,
  separatorIdsAt,
  setCollapsedContent,
  setCoveredHidden,
} from '../dom/panes';
import { createResizeWork, type ResizeStrategy } from '../dom/resize-work';
import {
  boundaryOffset,
  clearTabDrop,
  readTabEdges,
  showTabDrop,
  type TabEdges,
} from '../dom/tab-drag';
import {
  dragSizes,
  dropTarget,
  type DropTarget,
  getExitEdges,
  keySizes,
  paneAt,
  tabBoundaryAt,
  tabMoveIndex,
} from '../gestures';
import { getPanes, shownPanes, stackOf } from '../model';
import type { LayoutStore } from '../store';
import type {
  ChildSize,
  Edge,
  LayoutGeometry,
  LayoutNode,
  PaneNode,
  Rect,
  SeparatorGeometry,
  StackNode,
} from '../types';

export { PANE_VISIBILITY_EVENT, type PaneVisibilityEvent } from '../dom/panes';
export type { ResizeStrategy } from '../dom/resize-work';

/**
 * A button in a pane header: drag to move, zoom, close, or collapse. The
 * collapse button is not in the default actions.
 */
export type PaneAction = 'move' | 'zoom' | 'close' | 'collapse';

// Pane layers save compositing time from about 6 visible panes, and cost
// tile memory below that.
const DEFAULT_PANE_LAYERS = { minPanes: 6 };

const ALL_PANE_ACTIONS: readonly PaneAction[] = ['move', 'zoom', 'close'];

export interface LayoutProps {
  store: LayoutStore;
  /**
   * The content of a pane. It runs again when the pane node changes, except
   * for a change of `hidden`, `collapsed`, or `collapsedSize` alone: the
   * content of a pane that hides, shows, collapses, or expands does not
   * render, and receives `PANE_VISIBILITY_EVENT` instead.
   */
  renderPane: (pane: PaneNode) => ReactNode;
  getPaneTitle?: (pane: PaneNode) => string;
  /**
   * Which changes animate. `layout` covers changes of the split tree: split,
   * close, move, hide, and show. `zoom` covers zoom and restore. Both are true
   * by default; with `false`, the change applies at once. A user's
   * `prefers-reduced-motion: reduce` turns both off.
   */
  animate?: { layout?: boolean; zoom?: boolean };
  /**
   * Whether each pane host is its own compositor layer: `true`, `false`, or
   * `{ minPanes }` to turn the layers on from that number of visible panes.
   * A layer for each pane makes an update in one pane cheaper for the
   * compositor when there are many panes, and costs tile memory when there
   * are few. `{ minPanes: 6 }` by default: below 6 visible panes, the layers
   * cost memory and save no measured time.
   */
  paneLayers?: boolean | { minPanes: number };
  /**
   * The buttons of each pane header, for all panes or for each pane. All three
   * by default.
   */
  paneActions?:
    | readonly PaneAction[]
    | ((pane: PaneNode) => readonly PaneAction[]);
  /**
   * Called by the close button of a pane instead of `store.close`, for example
   * to hide the pane with `store.setHidden` so that it keeps its content.
   */
  onPaneClose?: (pane: PaneNode) => void;
  className?: string;
  style?: CSSProperties;
  gap?: number;
  /** Accessible name of the workspace. */
  label?: string;
  /**
   * Experimental, for `explore-resize-drag-content-layout`: how a pointer
   * resize applies its sizes (see `ResizeStrategy`).
   */
  experimentalResize?: ResizeStrategy;
  /**
   * Experimental, for `explore-size-animation-without-stretch`: how a pane
   * that changes size animates. `counter-scale` keeps its header and content
   * in shape; `scale` scales them with the pane, as before.
   */
  experimentalSizeAnimation?: 'counter-scale' | 'scale';
}

interface ResizeGesture {
  type: 'resize';
  pointerId: number;
  x: number;
  y: number;
  separators: readonly SeparatorGeometry[];
  originalSizes: Record<string, readonly ChildSize[]>;
}

interface MoveGesture {
  type: 'move';
  pointerId: number;
  x: number;
  y: number;
  paneId: string;
}

/** A drag of a tab to a new place in its tab list. */
interface TabGesture {
  type: 'tab';
  pointerId: number;
  x: number;
  y: number;
  paneId: string;
  tab: HTMLElement;
  tablist: HTMLElement;
  /** The IDs of the visible tabs, in order. */
  visible: readonly string[];
  /** The tab edges, read when the pointer has moved far enough to drag. */
  edges: TabEdges[] | null;
  /** The boundary of the list where the tab would go. */
  boundary: number | null;
}

// The compiled CSS of each tree, by gap. The view reads it before a change,
// to find whether any box moves, and when it renders the change.
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

/**
 * Whether a tree change moves or resizes an element that shows in both
 * trees. A change of tab, or a change inside a hidden pane, moves nothing,
 * so it needs no FLIP animation and no read of boxes.
 */
function boxesMove(before: CSSLayout, after: CSSLayout): boolean {
  const shown = (layout: CSSLayout): Map<string, string> =>
    new Map(
      layout.panes
        .filter(({ hidden }) => !hidden)
        .map(({ pane, rect }) => [pane.id, JSON.stringify(rect)])
    );
  const panesBefore = shown(before);
  for (const [id, rect] of shown(after)) {
    const old = panesBefore.get(id);
    if (old !== undefined && old !== rect) return true;
  }
  const key = (layout: CSSLayout): string =>
    JSON.stringify([
      layout.separators.map(({ id, rect }) => [id, rect]),
      layout.corners.map(({ id, left, top }) => [id, left, top]),
    ]);
  return key(before) !== key(after);
}

/** The node that a zoom of a pane fills the layout with: its stack, or the pane. */
const zoomKey = (root: LayoutNode, zoomedPane: string | null): string | null =>
  zoomedPane === null ? null : (stackOf(root, zoomedPane)?.id ?? zoomedPane);

// IDs of the tab of a pane in the header of a host. Each host of a stack
// renders the tabs of the stack, so a tab ID names the host too.
const tabIdOf = (prefix: string, host: string, tab: string): string =>
  `${prefix}-tab-${encodeURIComponent(host)}~${encodeURIComponent(tab)}`;

interface PaneBodyProps {
  pane: PaneNode;
  renderPane: (pane: PaneNode) => ReactNode;
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
 * True when a pane's content can keep its last render: the same `renderPane`,
 * and a pane node that is the same, or differs only in `LAYOUT_ONLY_KEYS`.
 * The host stops or starts the rendering of the content and sends
 * `PANE_VISIBILITY_EVENT`, so the content does not need to render for these.
 */
function sameContentProps(a: PaneBodyProps, b: PaneBodyProps): boolean {
  if (a.renderPane !== b.renderPane) return false;
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
 * The FLIP keys of the panes that show in `after` and that `store.setHidden`
 * hid in `before`, so that they grow into their place.
 */
function shownAgain(before: LayoutNode, after: LayoutNode): Set<string> {
  const hidden = new Set(
    getPanes(before)
      .filter((pane) => pane.hidden === true)
      .map(({ id }) => id)
  );
  return new Set(
    shownPanes(after)
      .filter(({ id }) => hidden.has(id))
      .map(({ id }) => `pane:${id}`)
  );
}

/**
 * The app's content of one pane. It renders only when its pane node or the
 * app's `renderPane` changes: focus, zoom, and size changes keep the pane
 * node, because the store keeps the identity of unchanged nodes, and a hide,
 * a show, a collapse, or an expand changes only `LAYOUT_ONLY_KEYS`.
 */
const PaneBody = memo(function PaneBody({
  pane,
  renderPane,
}: PaneBodyProps): JSX.Element {
  return <div className="pierre-layout-content">{renderPane(pane)}</div>;
}, sameContentProps);

// The box of a zoomed pane and of the focus indicator while a pane is zoomed.
const FULL_SIZE: CSSProperties = {
  left: 0,
  top: 0,
  width: '100%',
  height: '100%',
};

const rectStyle = (rect: Rect): CSSProperties => ({
  left: rect.x,
  top: rect.y,
  width: rect.width,
  height: rect.height,
});

/** Flat, keyed pane hosts retain application content while the split tree changes around them. */
export function Layout({
  store,
  renderPane,
  getPaneTitle = (pane) => pane.id,
  className,
  style,
  gap = 8,
  label = 'Workspace',
  paneActions = ALL_PANE_ACTIONS,
  onPaneClose,
  animate: animateOptions,
  paneLayers = DEFAULT_PANE_LAYERS,
  experimentalResize = 'live',
  experimentalSizeAnimation = 'counter-scale',
}: LayoutProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<ResizeGesture | MoveGesture | TabGesture | null>(null);
  const [resizing, setResizing] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [exitEdges, setExitEdges] = useState<Record<string, Edge>>({});
  const dropRef = useRef<DropTarget | null>(null);
  const prefix = useId();

  // Boxes before a store change, for the FLIP animation after React commits it.
  const boxesBefore = useRef<Map<string, Rect> | null>(null);
  // The tree of the last commit. The DOM shows it until React commits the
  // next tree, which can hold more than one store change.
  const committedRoot = useRef<LayoutNode | null>(null);
  const animateLayout = animateOptions?.layout !== false;
  const animateZoom = animateOptions?.zoom !== false;
  // The direct DOM work of a pointer resize with the `experimentalResize` strategy.
  const resizeWork = useMemo(() => createResizeWork(store), [store]);

  // Animate model changes only. CSS owns continuous sizing, including while JS is busy.
  const subscribe = useCallback(
    (listener: () => void): (() => void) => {
      let previous = store.getSnapshot();
      const unsubscribe = store.subscribe(() => {
        const element = rootRef.current;
        const next = store.getSnapshot();
        const zoom = next.zoomedPane;
        // Only a tree or zoom change moves elements. A focus change reads no
        // boxes: the focus indicator shows on the new pane at once. A change
        // of tab in a zoomed stack is not a zoom change: the stack stays.
        const zoomChanges =
          zoomKey(next.root, zoom) !==
          zoomKey(previous.root, previous.zoomedPane);
        const rootChanges = next.root !== previous.root;
        // A pointer resize follows the pointer with no animation.
        const animatable =
          element !== null &&
          (rootChanges || zoomChanges) &&
          (!rootChanges || animateLayout) &&
          (!zoomChanges || animateZoom) &&
          gesture.current?.type !== 'resize' &&
          !matchMedia('(prefers-reduced-motion: reduce)').matches;
        // A tree change animates when a box that shows before and after it
        // moves. A change of tab moves none. The check compares the compiled
        // CSS of both trees, which the render needs anyway.
        const animate =
          animatable &&
          (zoomChanges ||
            boxesMove(
              cssLayoutOf(previous.root, gap),
              cssLayoutOf(next.root, gap)
            ));
        const zoomStarts = zoomChanges && zoom !== null;
        if (element !== null && (animate || zoomStarts)) {
          // Layout is clean here, before React applies the change, so these reads are cheap.
          const boxes = readBoxes(element);
          if (zoomStarts) {
            const bounds = element.getBoundingClientRect();
            setExitEdges(getExitEdges(boxes, bounds.width, bounds.height));
          }
          // Stop running animations; the new animation starts from the current boxes.
          cancelFlipAnimations(element);
          boxesBefore.current = animate ? boxes : null;
        }
        // Show the covered panes before React commits a zoom change, so
        // that they render during the next animation.
        if (element !== null && zoomChanges) setCoveredHidden(element, null);
        previous = next;
        listener();
      });
      return unsubscribe;
    },
    [store, animateLayout, animateZoom, gap]
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
  // Style objects keep their identity while the tree does, so a focus or zoom
  // change gives React the same objects to compare.
  const styles = useMemo(
    () => ({
      panes: new Map(
        geometry.panes.map(({ pane, rect }): [string, CSSProperties] => [
          pane.id,
          rect,
        ])
      ),
      separators: new Map(
        geometry.separators.map(({ id, rect }): [string, CSSProperties] => [
          id,
          rect,
        ])
      ),
      corners: new Map(
        geometry.corners.map(({ id, left, top }): [string, CSSProperties] => [
          id,
          { left, top },
        ])
      ),
    }),
    [geometry]
  );
  // Keep DOM order independent of tree traversal: detach/reinsert can reset scroll and focus.
  const paneHosts = [...geometry.panes].sort((a, b) =>
    a.pane.id < b.pane.id ? -1 : a.pane.id > b.pane.id ? 1 : 0
  );
  const focused = geometry.panes.find(
    ({ pane }) => pane.id === (state.zoomedPane ?? state.focusedPane)
  );
  const visibleCount = geometry.panes.filter(({ hidden }) => !hidden).length;
  // A pane can close while another pane would still show: another visible
  // pane, or another visible tab of its stack.
  const closable = (pane: PaneNode, stack: StackNode | null): boolean =>
    visibleCount > 1 ||
    (stack?.children.some((tab) => tab.id !== pane.id && tab.hidden !== true) ??
      false);
  const layered =
    typeof paneLayers === 'boolean'
      ? paneLayers
      : visibleCount >= paneLayers.minPanes;
  const actionsOf = (pane: PaneNode): readonly PaneAction[] =>
    typeof paneActions === 'function' ? paneActions(pane) : paneActions;

  // Tell the content of a pane that stops or starts showing: store.setHidden
  // hides or shows it, or its tab changes. The content stays mounted, so it
  // can pause its own work.
  // A collapsed pane that is not zoomed shows its header only, and its
  // content does not render, so it counts as hidden here.
  // Most tree changes, such as each pointer move of a resize, hide no pane,
  // so the DOM is read only when the set of hidden panes changes.
  const hiddenBefore = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const hidden = new Set(
      geometry.panes
        .filter(
          ({ pane, hidden, collapsed }) =>
            hidden || (collapsed && pane.id !== state.zoomedPane)
        )
        .map(({ pane }) => pane.id)
    );
    const before = hiddenBefore.current;
    hiddenBefore.current = hidden;
    const element = rootRef.current;
    if (before === null || element === null) return;
    const changed =
      before.size !== hidden.size || [...hidden].some((id) => !before.has(id));
    if (changed) notifyHidden(element, before, hidden);
  }, [geometry, state.zoomedPane]);

  // The content of a collapsed pane is inert. The view sets it on the DOM, in
  // the same style update as the `content-visibility` of the content, so the
  // content does not render again for either change. The key changes only
  // when a pane collapses or expands, so a drag does no work here.
  const collapsedKey = JSON.stringify(
    geometry.panes
      .filter(
        ({ pane, collapsed }) => collapsed && pane.id !== state.zoomedPane
      )
      .map(({ pane }) => pane.id)
  );
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (element !== null)
      setCollapsedContent(
        element,
        new Set(JSON.parse(collapsedKey) as string[])
      );
  }, [collapsedKey]);

  // A tab that the user selects is in the header of the host that shows next.
  // Its host takes no input until React commits the change, so the focus
  // moves to it here, before the browser paints.
  const tabToFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const element = rootRef.current;
    const id = tabToFocus.current;
    tabToFocus.current = null;
    if (element !== null && id !== null) focusTab(element, id);
  }, [state]);

  // After React commits a store change, animate each moved element from its old box.
  // A pane that shows again grows into its place. The panes that show again
  // come from the last committed tree, not from one store change: an app
  // can show the panes of a stack with one call each before React commits.
  useLayoutEffect(() => {
    const element = rootRef.current;
    const before = boxesBefore.current;
    const committed = committedRoot.current;
    boxesBefore.current = null;
    committedRoot.current = state.root;
    if (element !== null && before !== null)
      animateFromBoxes(
        element,
        before,
        experimentalSizeAnimation === 'counter-scale',
        committed === null || committed === state.root
          ? new Set()
          : shownAgain(committed, state.root)
      );
  }, [state, experimentalSizeAnimation]);

  useEffect(() => {
    const element = rootRef.current;
    if (element === null) return;
    // No text selection during a gesture. An inherited style on the root,
    // such as user-select, would recalculate the style of all pane content.
    const preventSelection = (event: Event): void => {
      if (gesture.current !== null) event.preventDefault();
    };
    element.addEventListener('selectstart', preventSelection);
    return () => element.removeEventListener('selectstart', preventSelection);
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    if (element === null) return;
    // Observation only ends a discrete animation; it never computes bounds or updates React.
    const observer = new ResizeObserver(() => finishFlipAnimations(element));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Pixel geometry is needed only when a user starts resizing or points at a drop target.
  function readGeometry(): LayoutGeometry {
    const element = rootRef.current;
    if (element === null) return { panes: [], separators: [], corners: [] };
    return readPixelGeometry(element, store.getSnapshot().root, gap);
  }

  function separatorsAt(
    target: HTMLElement,
    ids: readonly string[]
  ): SeparatorGeometry[] {
    const element = rootRef.current;
    if (element === null) return [];
    const touching = separatorIdsAt(element, target, ids, geometry.corners);
    return readGeometry().separators.filter(({ id }) => touching.has(id));
  }

  // Move the focus into the zoomed pane first: a focused element in a pane
  // with `content-visibility: hidden` loses the focus to `body`. When the
  // zoom animation ends, the covered panes skip rendering.
  useEffect(() => {
    const element = rootRef.current;
    const zoomedPane = state.zoomedPane;
    if (element === null || zoomedPane === null) return;
    focusZoomedPane(element, zoomedPane);
    let current = true;
    // A tree change during the zoom cancels its animations, and the covered
    // panes then hide at once. A zoom change also cancels them, before React
    // ends this effect, so check the store too.
    hideCoveredAfterAnimation(
      element,
      zoomedPane,
      () => current && store.getSnapshot().zoomedPane === zoomedPane
    );
    return () => {
      current = false;
    };
  }, [state.zoomedPane, store]);

  function startResize(
    event: PointerEvent<HTMLElement>,
    ids: readonly string[]
  ): void {
    const separators = separatorsAt(event.currentTarget, ids);
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      type: 'resize',
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      separators,
      originalSizes: Object.fromEntries(
        separators.map(({ split }) => [split.id, split.sizes])
      ),
    };
    setResizing(true);
  }

  function startMove(
    event: PointerEvent<HTMLButtonElement>,
    paneId: string
  ): void {
    if (event.button !== 0 || state.zoomedPane !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      type: 'move',
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      paneId,
    };
  }

  function selectTab(id: string): void {
    tabToFocus.current = id;
    store.activate(id);
  }

  /**
   * Move a tab to a boundary of its tab list (see `tabMoveIndex`). The tab
   * keeps the focus.
   */
  function moveTabTo(
    stack: StackNode,
    visible: readonly string[],
    id: string,
    boundary: number
  ): void {
    const index = tabMoveIndex(
      stack.children.map((pane) => pane.id),
      visible,
      id,
      boundary
    );
    if (index === null) return;
    tabToFocus.current = id;
    store.moveTab(id, index);
  }

  /**
   * The keys of the tab list, from the APG tabs pattern: arrows move to the
   * next or the previous tab, and Home and End to the first or the last. The
   * tab that gets the focus shows. Delete closes the focused tab. Ctrl+Shift
   * with PageUp or PageDown moves the focused tab before the previous tab or
   * after the next one, as Firefox, Chrome, and VS Code move their tabs.
   */
  function tabKey(
    event: KeyboardEvent<HTMLElement>,
    tabs: readonly PaneNode[],
    tab: PaneNode,
    stack: StackNode
  ): void {
    const at = tabs.indexOf(tab);
    if (
      event.ctrlKey &&
      event.shiftKey &&
      (event.key === 'PageUp' || event.key === 'PageDown')
    ) {
      // The browser does not move its own tab for a key that the page uses.
      event.preventDefault();
      const boundary = event.key === 'PageUp' ? at - 1 : at + 2;
      if (boundary >= 0 && boundary <= tabs.length)
        moveTabTo(
          stack,
          tabs.map((pane) => pane.id),
          tab.id,
          boundary
        );
      return;
    }
    const next =
      event.key === 'ArrowRight'
        ? tabs[(at + 1) % tabs.length]
        : event.key === 'ArrowLeft'
          ? tabs[(at - 1 + tabs.length) % tabs.length]
          : event.key === 'Home'
            ? tabs[0]
            : event.key === 'End'
              ? tabs[tabs.length - 1]
              : null;
    if (next !== null) {
      event.preventDefault();
      if (next.id !== tab.id) selectTab(next.id);
    } else if (
      event.key === 'Delete' &&
      actionsOf(tab).includes('close') &&
      closable(tab, stack)
    ) {
      event.preventDefault();
      closePane(tab);
    }
  }

  function closePane(pane: PaneNode): void {
    // A tab that closes from the tab list gives the focus to the tab that
    // shows next, as the APG tabs pattern does.
    const fromTab = document.activeElement?.getAttribute('role') === 'tab';
    if (onPaneClose !== undefined) onPaneClose(pane);
    else store.close(pane.id);
    requestAnimationFrame(() => {
      const element = rootRef.current;
      if (element === null) return;
      const focused = store.getSnapshot().focusedPane;
      if (fromTab) focusTab(element, focused);
      else focusPane(element, focused);
    });
  }

  /**
   * Start a possible drag of a tab. It becomes a drag when the pointer moves
   * 4 px; a press without a move stays a click. A press on the close mark is
   * a click.
   */
  function startTabDrag(
    event: PointerEvent<HTMLElement>,
    id: string,
    tabs: readonly PaneNode[]
  ): void {
    const tablist = event.currentTarget.parentElement;
    if (
      event.button !== 0 ||
      tabs.length < 2 ||
      tablist === null ||
      (event.target as Element).closest('.pierre-layout-tab-close') !== null
    )
      return;
    gesture.current = {
      type: 'tab',
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      paneId: id,
      tab: event.currentTarget,
      tablist,
      visible: tabs.map((tab) => tab.id),
      edges: null,
      boundary: null,
    };
  }

  /**
   * Follow a tab drag: show where the tab would go. The tab edges are read
   * once, when the drag starts, so a move writes one transform and reads
   * nothing.
   */
  function dragTab(active: TabGesture, event: PointerEvent): void {
    if (active.edges === null) {
      if (Math.hypot(event.clientX - active.x, event.clientY - active.y) < 4)
        return;
      active.edges = readTabEdges(active.tablist);
      try {
        active.tab.setPointerCapture(active.pointerId);
      } catch {
        // The pointer is no longer active; the next event ends the gesture.
      }
      active.tab.dataset.dragging = 'true';
    }
    const x = event.clientX - active.tablist.getBoundingClientRect().left;
    active.boundary = tabBoundaryAt(active.edges, x);
    showTabDrop(active.tablist, boundaryOffset(active.edges, active.boundary));
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>): void {
    const active = gesture.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    if (active.type === 'tab') {
      dragTab(active, event);
    } else if (active.type === 'resize') {
      const element = rootRef.current;
      if (element === null) return;
      resizeWork.apply(
        element,
        experimentalResize,
        active.separators,
        dragSizes(
          active.separators,
          event.clientX - active.x,
          event.clientY - active.y
        ),
        geometry.corners
      );
    } else {
      if (Math.hypot(event.clientX - active.x, event.clientY - active.y) < 4)
        return;
      setDragging(active.paneId);
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const target = paneAt(readGeometry(), x, y, active.paneId);
      const next =
        target === undefined
          ? null
          : dropTarget(target.pane.id, target.rect, x, y);
      dropRef.current = next;
      setDrop(next);
    }
  }

  function finishGesture(cancel: boolean, pointerId?: number): void {
    const active = gesture.current;
    if (
      active === null ||
      (pointerId !== undefined && active.pointerId !== pointerId)
    )
      return;
    if (active.type === 'resize') resizeWork.end(cancel);
    gesture.current = null;
    if (active.type === 'tab') {
      clearTabDrop(active.tablist);
      delete active.tab.dataset.dragging;
      const stack = stackOf(store.getSnapshot().root, active.paneId);
      if (!cancel && active.boundary !== null && stack !== null)
        moveTabTo(stack, active.visible, active.paneId, active.boundary);
      return;
    }
    if (active.type === 'resize' && cancel)
      store.setSizes(active.originalSizes);
    if (active.type === 'move' && !cancel && dropRef.current !== null) {
      store.move(active.paneId, dropRef.current.paneId, dropRef.current.edge);
    }
    dropRef.current = null;
    setResizing(false);
    setDragging(null);
    setDrop(null);
  }

  function resizeKey(
    event: KeyboardEvent<HTMLElement>,
    ids: readonly string[]
  ): void {
    const sizes = keySizes(
      separatorsAt(event.currentTarget, ids),
      event.key,
      event.shiftKey
    );
    if (sizes !== null) {
      event.preventDefault();
      store.setSizes(sizes);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`pierre-layout ${className ?? ''}`}
      style={style}
      role="group"
      aria-label={label}
      data-resizing={resizing}
      data-pane-layers={layered}
      data-dragging={dragging !== null}
      onPointerMove={pointerMove}
      onPointerUp={(event) => finishGesture(false, event.pointerId)}
      onPointerCancel={(event) => finishGesture(true, event.pointerId)}
      onLostPointerCapture={(event) => finishGesture(true, event.pointerId)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          finishGesture(true);
          if (state.zoomedPane !== null) store.toggleZoom();
        }
      }}
    >
      {paneHosts.map(({ pane, hidden: notShown, stack, collapsed }) => {
        const covered =
          !notShown &&
          state.zoomedPane !== null &&
          state.zoomedPane !== pane.id;
        const hidden = notShown || covered;
        const tabs = stack?.children.filter((tab) => tab.hidden !== true) ?? [];
        const tabbed = tabs.length > 0;
        const zoomed = state.zoomedPane === pane.id;
        // A zoomed pane shows its content, also when it is collapsed.
        const folded = collapsed && !zoomed;
        const actions = actionsOf(pane);
        const edge = exitEdges[pane.id] ?? 'left';
        // A covered pane keeps its geometry and moves past an edge with a
        // transform, so that it does not lay out its content again. One
        // container size is always enough to leave the container.
        const exit =
          edge === 'left'
            ? `translateX(calc(-100cqw - ${gap}px))`
            : edge === 'right'
              ? `translateX(calc(100cqw + ${gap}px))`
              : edge === 'top'
                ? `translateY(calc(-100cqh - ${gap}px))`
                : `translateY(calc(100cqh + ${gap}px))`;
        return (
          <section
            key={pane.id}
            id={`${prefix}-${encodeURIComponent(pane.id)}`}
            data-layout-pane={pane.id}
            data-layout-flip={`pane:${pane.id}`}
            className="pierre-layout-pane"
            tabIndex={hidden ? -1 : 0}
            // The host of a tab is its tab panel, named by its tab.
            role={tabbed ? 'tabpanel' : undefined}
            aria-label={tabbed ? undefined : getPaneTitle(pane)}
            aria-labelledby={
              tabbed ? tabIdOf(prefix, pane.id, pane.id) : undefined
            }
            aria-hidden={hidden}
            // A covered pane becomes inert when its content stops rendering,
            // at the end of the zoom animation (setCoveredHidden).
            inert={notShown}
            data-pane-hidden={notShown}
            data-collapsed={folded}
            data-focused={state.focusedPane === pane.id}
            data-zoomed={zoomed}
            data-moving={dragging === pane.id}
            style={
              zoomed
                ? FULL_SIZE
                : covered
                  ? { ...styles.panes.get(pane.id), transform: exit }
                  : styles.panes.get(pane.id)
            }
            onFocusCapture={() => store.focusPane(pane.id)}
            onPointerDown={() => store.focusPane(pane.id)}
          >
            {/* The inner wrapper takes the inverse of the host's FLIP scale,
                so the header and the content keep their shape. */}
            <div className="pierre-layout-pane-inner">
              <header className="pierre-layout-header">
                {actions.includes('move') && (
                  <button
                    type="button"
                    className="pierre-layout-grip"
                    aria-label={`Drag ${getPaneTitle(pane)}`}
                    title="Drag to move this pane beside another"
                    // Not `disabled`, and only on the zoomed pane: a state
                    // change on every pane would lay each grip out again.
                    // startMove ignores a drag while a pane is zoomed.
                    aria-disabled={zoomed || undefined}
                    onPointerDown={(event) => startMove(event, pane.id)}
                  >
                    ⠿
                  </button>
                )}
                {tabbed && stack !== null ? (
                  <div
                    role="tablist"
                    className="pierre-layout-tabs"
                    aria-label={`Tabs of ${getPaneTitle(pane)}`}
                  >
                    {tabs.map((tab) => {
                      const selected = tab.id === pane.id;
                      const title = getPaneTitle(tab);
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          id={tabIdOf(prefix, pane.id, tab.id)}
                          className="pierre-layout-tab"
                          aria-selected={selected}
                          aria-controls={`${prefix}-${encodeURIComponent(tab.id)}`}
                          tabIndex={selected ? 0 : -1}
                          data-layout-tab={tab.id}
                          onPointerDown={(event) =>
                            startTabDrag(event, tab.id, tabs)
                          }
                          onClick={() => {
                            if (!selected) selectTab(tab.id);
                          }}
                          onKeyDown={(event) => tabKey(event, tabs, tab, stack)}
                        >
                          <span className="pierre-layout-tab-title">
                            {title}
                          </span>
                          {actionsOf(tab).includes('close') &&
                            closable(tab, stack) && (
                              // A pointer shortcut: Delete on the tab and the
                              // header's close button do the same.
                              <span
                                className="pierre-layout-tab-close"
                                aria-hidden="true"
                                title={`Close ${title}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  closePane(tab);
                                }}
                              >
                                ×
                              </span>
                            )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <span className="pierre-layout-title">
                    {getPaneTitle(pane)}
                  </span>
                )}
                {actions.includes('collapse') && (
                  <button
                    type="button"
                    aria-label={`Collapse ${getPaneTitle(pane)}`}
                    aria-pressed={collapsed}
                    onClick={() => store.setCollapsed(pane.id, !collapsed)}
                  >
                    {collapsed ? '▸' : '▾'}
                  </button>
                )}
                {actions.includes('zoom') && (
                  <button
                    type="button"
                    aria-label={`${zoomed ? 'Restore' : 'Zoom'} ${getPaneTitle(pane)}`}
                    aria-pressed={zoomed}
                    onClick={() => store.toggleZoom(pane.id)}
                  >
                    {zoomed ? '↙' : '↗'}
                  </button>
                )}
                {actions.includes('close') && (
                  <button
                    type="button"
                    aria-label={`Close ${getPaneTitle(pane)}`}
                    disabled={!closable(pane, stack)}
                    onClick={() => closePane(pane)}
                  >
                    ×
                  </button>
                )}
              </header>
              <PaneBody pane={pane} renderPane={renderPane} />
            </div>
          </section>
        );
      })}
      {/* The indicator has the FLIP key of its pane, so it moves with that
          pane. A focus change replaces it, so it never moves to another pane. */}
      {focused !== undefined && (
        <div
          key={focused.pane.id}
          className="pierre-layout-focus"
          data-layout-flip={`pane:${focused.pane.id}`}
          aria-hidden="true"
          style={
            state.zoomedPane !== null
              ? FULL_SIZE
              : styles.panes.get(focused.pane.id)
          }
        />
      )}
      {state.zoomedPane === null &&
        geometry.separators.map((separator) => {
          // The separator resizes the two children beside it first.
          const before = shownPanes(separator.before);
          const after = shownPanes(separator.split.children[separator.index]);
          const value = Math.round(separator.value * 100);
          return (
            <div
              key={separator.id}
              className="pierre-layout-separator"
              role="separator"
              tabIndex={0}
              aria-label={`Resize ${before.map(getPaneTitle).join(', ')} and ${after.map(getPaneTitle).join(', ')}`}
              aria-orientation={
                separator.split.direction === 'horizontal'
                  ? 'vertical'
                  : 'horizontal'
              }
              aria-controls={[...before, ...after]
                .map(({ id }) => `${prefix}-${encodeURIComponent(id)}`)
                .join(' ')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={value}
              aria-valuetext={`${value}% preferred position`}
              data-direction={separator.split.direction}
              data-layout-flip={`separator:${separator.id}`}
              style={styles.separators.get(separator.id)}
              onPointerDown={(event) => startResize(event, [separator.id])}
              onKeyDown={(event) => resizeKey(event, [separator.id])}
            />
          );
        })}
      {state.zoomedPane === null &&
        geometry.corners.map((corner) => (
          <button
            key={corner.id}
            type="button"
            className="pierre-layout-corner"
            aria-label="Resize both axes"
            style={styles.corners.get(corner.id)}
            data-layout-corner={corner.id}
            data-layout-flip={`corner:${corner.id}`}
            onPointerDown={(event) => startResize(event, corner.separatorIds)}
            onKeyDown={(event) => resizeKey(event, corner.separatorIds)}
          />
        ))}
      {drop !== null && (
        <div
          className="pierre-layout-drop"
          style={rectStyle(drop.rect)}
          aria-hidden="true"
        />
      )}
      <span className="pierre-layout-sr" role="status" aria-live="polite">
        {dragging !== null && drop !== null
          ? `Move ${dragging} to the ${drop.edge} of ${drop.paneId}`
          : state.zoomedPane !== null
            ? `${state.zoomedPane} zoomed`
            : `${visibleCount} panes`}
      </span>
    </div>
  );
}
