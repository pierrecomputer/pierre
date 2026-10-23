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

import { computeCSSLayout } from '../css-layout';
import { computeLayout, getExitEdge } from '../geometry';
import { getPanes } from '../model';
import type { LayoutStore } from '../store';
import type {
  Edge,
  LayoutGeometry,
  LayoutNode,
  PaneNode,
  Rect,
  SeparatorGeometry,
} from '../types';

/** A button in a pane header: drag to move, zoom, or close. */
export type PaneAction = 'move' | 'zoom' | 'close';

const ALL_PANE_ACTIONS: readonly PaneAction[] = ['move', 'zoom', 'close'];

export interface LayoutProps {
  store: LayoutStore;
  renderPane: (pane: PaneNode) => ReactNode;
  getPaneTitle?: (pane: PaneNode) => string;
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
   * resize applies its ratios. `live` writes them on each pointer move,
   * `frame` once per animation frame, `preview` moves only the separator and
   * writes them on release, and `freeze` writes them live but keeps the size
   * of the content of the affected panes until the pointer pauses. `settle`
   * is `freeze`, but the content takes its new size one pane per frame.
   */
  experimentalResize?: 'live' | 'frame' | 'preview' | 'freeze' | 'settle';
  /**
   * Experimental, for `explore-size-animation-without-stretch`: how a pane
   * that changes size animates. `counter-scale` keeps its header and content
   * in shape; `scale` scales them with the pane, as before.
   */
  experimentalSizeAnimation?: 'counter-scale' | 'scale';
}

// Pause after which a frozen drag lets pane content take its new size.
const FREEZE_PAUSE_MS = 150;

/**
 * The event that a pane host receives when its content stops or starts
 * rendering. `detail.hidden` is true when the zoom animation of another pane
 * ends, and false before the pane shows again.
 */
export const PANE_VISIBILITY_EVENT = 'pierre-layout-visibility';
export type PaneVisibilityEvent = CustomEvent<{ hidden: boolean }>;

interface ResizeGesture {
  type: 'resize';
  pointerId: number;
  x: number;
  y: number;
  separators: readonly SeparatorGeometry[];
  originalRatios: Record<string, number>;
}

interface MoveGesture {
  type: 'move';
  pointerId: number;
  x: number;
  y: number;
  paneId: string;
}

interface DropTarget {
  paneId: string;
  edge: Edge;
  rect: Rect;
}

// Elements that animate a layout change carry this attribute with a stable key.
const FLIP_ATTRIBUTE = 'data-layout-flip';
// A hidden pane does not render, so it neither gives nor takes a FLIP box.
const FLIP_SELECTOR = `[${FLIP_ATTRIBUTE}]:not([data-collapsed='true'])`;
const DEFAULT_DURATION_MS = 240;
// The ID of the layout's own animations, so that it never touches animations in pane content.
const FLIP_ANIMATION_ID = 'pierre-layout-flip';
// An ease-out curve, written as cubic-bezier: Safari runs `linear()` easing on the main thread.
const FLIP_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/** The layout's running FLIP animations; animations in pane content are not included. */
function flipAnimations(root: HTMLElement): Animation[] {
  return root
    .getAnimations({ subtree: true })
    .filter((animation) => animation.id === FLIP_ANIMATION_ID);
}

/** Read the box of each animatable element, relative to the layout root, including running animations. */
function readBoxes(root: HTMLElement): Map<string, Rect> {
  const bounds = root.getBoundingClientRect();
  const boxes = new Map<string, Rect>();
  for (const element of root.querySelectorAll<HTMLElement>(FLIP_SELECTOR)) {
    const key = element.getAttribute(FLIP_ATTRIBUTE) ?? '';
    // The focus indicator shares the key of its pane and comes after it. Keep
    // the box of the pane, so that both elements animate from it.
    if (boxes.has(key)) continue;
    const box = element.getBoundingClientRect();
    boxes.set(key, {
      x: box.left - bounds.left,
      y: box.top - bounds.top,
      width: box.width,
      height: box.height,
    });
  }
  return boxes;
}

function durationOf(root: HTMLElement): number {
  const value = getComputedStyle(root).getPropertyValue('--layout-duration');
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return DEFAULT_DURATION_MS;
  return value.trim().endsWith('ms') ? parsed : parsed * 1000;
}

// Keyframes of the inverse scale of a pane's content. The inverse of a linear
// scale is not linear, so it is sampled: 16 steps keep the content within a
// fraction of a pixel of its own size.
const COUNTER_SCALE_STEPS = 16;

/**
 * FLIP: each element already has its final geometry. Animate it from its old box
 * with a transform only, so that the compositor runs the animation and content
 * lays out once. `transform-origin` is `0 0` on these elements. With
 * `counterScale`, the inner wrapper of a pane host gets the inverse of the
 * host's scale on each frame, so its header and content keep their shape and
 * the frame reveals or clips them, instead of stretching them.
 */
function animateFromBoxes(
  root: HTMLElement,
  before: Map<string, Rect>,
  counterScale: boolean
): void {
  const duration = durationOf(root);
  const bounds = root.getBoundingClientRect();
  // Read every box before the first animation starts: a new animation dirties
  // style, and a read after it would force another layout.
  const plans: { element: HTMLElement; start: DOMMatrix; end: DOMMatrix }[] =
    [];
  for (const element of root.querySelectorAll<HTMLElement>(FLIP_SELECTOR)) {
    const from = before.get(element.getAttribute(FLIP_ATTRIBUTE) ?? '');
    // A new element has no old box. It appears in place.
    if (from === undefined) continue;
    const box = element.getBoundingClientRect();
    const to = {
      x: box.left - bounds.left,
      y: box.top - bounds.top,
      width: box.width,
      height: box.height,
    };
    if (
      Math.abs(from.x - to.x) < 0.5 &&
      Math.abs(from.y - to.y) < 0.5 &&
      Math.abs(from.width - to.width) < 0.5 &&
      Math.abs(from.height - to.height) < 0.5
    )
      continue;
    if (to.width === 0 || to.height === 0) continue;
    // The element's own transform, for example the translate of a covered pane,
    // is the end of the animation. Its layout box is the box without it.
    const own = getComputedStyle(element).transform;
    const end = own === 'none' ? new DOMMatrix() : new DOMMatrix(own);
    const start = new DOMMatrix([
      from.width / to.width,
      0,
      0,
      from.height / to.height,
      from.x - (to.x - end.e),
      from.y - (to.y - end.f),
    ]);
    plans.push({ element, start, end });
  }
  const timing: KeyframeAnimationOptions = {
    duration,
    easing: FLIP_EASING,
    id: FLIP_ANIMATION_ID,
  };
  for (const { element, start, end } of plans) {
    element.animate(
      [{ transform: start.toString() }, { transform: end.toString() }],
      timing
    );
    const inner = counterScale
      ? element.querySelector<HTMLElement>(':scope > .pierre-layout-pane-inner')
      : null;
    if (inner === null || (start.a === end.a && start.d === end.d)) continue;
    // Both animations share the timing, so at each eased progress the host's
    // scale is the linear mix of its keyframes, and the inner scale undoes it.
    const frames: Keyframe[] = [];
    for (let step = 0; step <= COUNTER_SCALE_STEPS; step++) {
      const progress = step / COUNTER_SCALE_STEPS;
      const x = start.a + (end.a - start.a) * progress;
      const y = start.d + (end.d - start.d) * progress;
      frames.push({
        offset: progress,
        transform: `scale(${end.a / x}, ${end.d / y})`,
      });
    }
    inner.animate(frames, timing);
  }
}

/** The panes of a subtree that take space. */
const shownPanes = (node: LayoutNode): PaneNode[] =>
  getPanes(node).filter(({ hidden }) => hidden !== true);

/**
 * Hide each pane host that the zoomed pane covers, or show every host when
 * `zoomedPane` is null. A style rule gives a hidden host
 * `content-visibility: hidden`. The view sets the attribute itself, so that
 * the change does not render every pane host again. Each host whose state
 * changes receives `PANE_VISIBILITY_EVENT`. The pane hosts are children of
 * the root; a query of the subtree would also walk all pane content.
 */
function setCoveredHidden(root: HTMLElement, zoomedPane: string | null): void {
  for (const host of root.children) {
    // A hidden pane does not render whatever the zoom.
    if (
      !(host instanceof HTMLElement) ||
      host.dataset.layoutPane === undefined ||
      host.dataset.collapsed === 'true'
    )
      continue;
    const hidden =
      zoomedPane !== null && host.dataset.layoutPane !== zoomedPane;
    if ((host.dataset.hidden === 'true') === hidden) continue;
    if (hidden) host.dataset.hidden = 'true';
    else delete host.dataset.hidden;
    host.dispatchEvent(
      new CustomEvent(PANE_VISIBILITY_EVENT, { detail: { hidden } })
    );
  }
}

/**
 * The app's content of one pane. It renders only when its pane node or the
 * app's `renderPane` changes: focus, zoom, and ratio changes keep the pane
 * node, because the store keeps the identity of unchanged nodes.
 */
const PaneBody = memo(function PaneBody({
  pane,
  renderPane,
}: {
  pane: PaneNode;
  renderPane: (pane: PaneNode) => ReactNode;
}): JSX.Element {
  return <div className="pierre-layout-content">{renderPane(pane)}</div>;
});

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

/** Pick the closest side of a pane and show exactly where a dragged pane will be inserted. */
function dropTarget(
  paneId: string,
  rect: Rect,
  x: number,
  y: number
): DropTarget {
  const sides: [Edge, number][] = [
    ['left', (x - rect.x) / rect.width],
    ['right', (rect.x + rect.width - x) / rect.width],
    ['top', (y - rect.y) / rect.height],
    ['bottom', (rect.y + rect.height - y) / rect.height],
  ];
  const edge = sides.sort((a, b) => a[1] - b[1])[0][0];
  return {
    paneId,
    edge,
    rect: {
      x: rect.x + (edge === 'right' ? rect.width / 2 : 0),
      y: rect.y + (edge === 'bottom' ? rect.height / 2 : 0),
      width: edge === 'left' || edge === 'right' ? rect.width / 2 : rect.width,
      height:
        edge === 'top' || edge === 'bottom' ? rect.height / 2 : rect.height,
    },
  };
}

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
  experimentalResize = 'live',
  experimentalSizeAnimation = 'counter-scale',
}: LayoutProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<ResizeGesture | MoveGesture | null>(null);
  const [resizing, setResizing] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [exitEdges, setExitEdges] = useState<Record<string, Edge>>({});
  const dropRef = useRef<DropTarget | null>(null);
  const prefix = useId();

  // Boxes before a store change, for the FLIP animation after React commits it.
  const boxesBefore = useRef<Map<string, Rect> | null>(null);
  // DOM work of a pointer resize that React does not own, for the
  // `experimentalResize` variants: a pending frame, the ratios that wait for
  // it or for the release, moved separators, and frozen pane content.
  const resizeWork = useRef<{
    frame: number | null;
    pending: Record<string, number> | null;
    moved: HTMLElement[];
    frozen: HTMLElement[];
    pause: ReturnType<typeof setTimeout> | null;
    thawing: HTMLElement[];
  }>({
    frame: null,
    pending: null,
    moved: [],
    frozen: [],
    pause: null,
    thawing: [],
  });

  // Animate model changes only. CSS owns continuous sizing, including while JS is busy.
  const subscribe = useCallback(
    (listener: () => void): (() => void) => {
      let previous = store.getSnapshot();
      const unsubscribe = store.subscribe(() => {
        const element = rootRef.current;
        const next = store.getSnapshot();
        const zoom = next.zoomedPane;
        // Only a tree or zoom change moves elements. A focus change reads no
        // boxes: the focus indicator shows on the new pane at once.
        const moves =
          next.root !== previous.root || zoom !== previous.zoomedPane;
        // A pointer resize follows the pointer with no animation.
        const animate =
          element !== null &&
          moves &&
          gesture.current?.type !== 'resize' &&
          !matchMedia('(prefers-reduced-motion: reduce)').matches;
        const zoomStarts = zoom !== previous.zoomedPane && zoom !== null;
        if (element !== null && (animate || zoomStarts)) {
          // Layout is clean here, before React applies the change, so these reads are cheap.
          const boxes = readBoxes(element);
          if (zoomStarts) {
            const bounds = element.getBoundingClientRect();
            const edges: Record<string, Edge> = {};
            for (const [key, box] of boxes) {
              if (key.startsWith('pane:'))
                edges[key.slice(5)] = getExitEdge(
                  box,
                  bounds.width,
                  bounds.height
                );
            }
            setExitEdges(edges);
          }
          // Stop running animations; the new animation starts from the current boxes.
          for (const animation of flipAnimations(element)) animation.cancel();
          boxesBefore.current = animate ? boxes : null;
        }
        // Show the covered panes before React commits a zoom change, so
        // that they render during the next animation.
        if (element !== null && zoom !== previous.zoomedPane)
          setCoveredHidden(element, null);
        previous = next;
        listener();
      });
      return unsubscribe;
    },
    [store]
  );
  const state = useSyncExternalStore(
    subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  // The store keeps the tree on focus and zoom changes, so this runs only when
  // the tree or the gap changes.
  const geometry = useMemo(
    () => computeCSSLayout(state.root, gap),
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
        geometry.separators.map(({ split, rect }): [string, CSSProperties] => [
          split.id,
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
  const actionsOf = (pane: PaneNode): readonly PaneAction[] =>
    typeof paneActions === 'function' ? paneActions(pane) : paneActions;

  // Tell the content of a pane that store.setHidden hides or shows. A hidden
  // pane keeps its content mounted, so the content can pause its own work.
  const collapsedBefore = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const collapsed = new Set(
      geometry.panes.filter(({ hidden }) => hidden).map(({ pane }) => pane.id)
    );
    const before = collapsedBefore.current;
    collapsedBefore.current = collapsed;
    const element = rootRef.current;
    if (before === null || element === null) return;
    for (const host of element.children) {
      if (!(host instanceof HTMLElement)) continue;
      const id = host.dataset.layoutPane;
      if (id === undefined || collapsed.has(id) === before.has(id)) continue;
      host.dispatchEvent(
        new CustomEvent(PANE_VISIBILITY_EVENT, {
          detail: { hidden: collapsed.has(id) },
        })
      );
    }
  }, [geometry]);

  // After React commits a store change, animate each moved element from its old box.
  useLayoutEffect(() => {
    const element = rootRef.current;
    const before = boxesBefore.current;
    boxesBefore.current = null;
    if (element !== null && before !== null)
      animateFromBoxes(
        element,
        before,
        experimentalSizeAnimation === 'counter-scale'
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
    const observer = new ResizeObserver(() => {
      for (const animation of flipAnimations(element)) animation.finish();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Pixel geometry is needed only when a user starts resizing or points at a drop target.
  function readGeometry(): LayoutGeometry {
    const element = rootRef.current;
    const bounds = element?.getBoundingClientRect();
    return computeLayout(
      store.getSnapshot().root,
      bounds?.width ?? 0,
      bounds?.height ?? 0,
      gap
    );
  }

  function separatorsAt(
    element: HTMLElement,
    ids: readonly string[]
  ): SeparatorGeometry[] {
    const touching = new Set(ids);
    if (element.classList.contains('pierre-layout-corner')) {
      const bounds = element.getBoundingClientRect();
      for (const corner of rootRef.current?.querySelectorAll<HTMLElement>(
        '[data-layout-corner]'
      ) ?? []) {
        const other = corner.getBoundingClientRect();
        if (
          Math.abs(bounds.x - other.x) < 1 &&
          Math.abs(bounds.y - other.y) < 1
        ) {
          const spec = geometry.corners.find(
            ({ id }) => id === corner.dataset.layoutCorner
          );
          for (const id of spec?.splitIds ?? []) touching.add(id);
        }
      }
    }
    return readGeometry().separators.filter(({ split }) =>
      touching.has(split.id)
    );
  }

  // Move the focus into the zoomed pane first: a focused element in a pane
  // with `content-visibility: hidden` loses the focus to `body`. When the
  // zoom animation ends, the covered panes skip rendering.
  useEffect(() => {
    const element = rootRef.current;
    const zoomedPane = state.zoomedPane;
    if (element === null || zoomedPane === null) return;
    const panes = Array.from(
      element.querySelectorAll<HTMLElement>('[data-layout-pane]')
    );
    const activePane = panes.find((pane) =>
      pane.contains(document.activeElement)
    );
    if (activePane?.dataset.layoutPane !== zoomedPane) {
      panes.find((pane) => pane.dataset.layoutPane === zoomedPane)?.focus();
    }
    let current = true;
    // A tree change during the zoom cancels these animations, and the covered
    // panes then hide at once. A zoom change also cancels them, before React
    // ends this effect, so check the store too.
    void Promise.allSettled(
      flipAnimations(element).map((animation) => animation.finished)
    ).then(() => {
      if (current && store.getSnapshot().zoomedPane === zoomedPane)
        setCoveredHidden(element, zoomedPane);
    });
    return () => {
      current = false;
    };
  }, [state.zoomedPane, store]);

  /**
   * Give the content of each pane under the dragged splits its current size in
   * pixels, so that a ratio change resizes the pane hosts but does not lay out
   * their content. While frozen, the content also has strict containment and
   * its own compositor layer, so that a host that moves or clips it does not
   * paint it again. All sizes are read before the first write.
   */
  function freezeContent(separators: readonly SeparatorGeometry[]): void {
    const work = resizeWork.current;
    const root = rootRef.current;
    if (root === null || work.frozen.length > 0) return;
    // Content that still waits to thaw is frozen again with the rest.
    if (work.frame !== null) cancelAnimationFrame(work.frame);
    work.frame = null;
    const waiting = work.thawing;
    work.thawing = [];
    const ids = new Set(
      separators.flatMap(({ split }) => getPanes(split).map(({ id }) => id))
    );
    const contents = Array.from(
      root.querySelectorAll<HTMLElement>('[data-layout-pane]')
    )
      .filter((pane) => ids.has(pane.dataset.layoutPane ?? ''))
      .map((pane) =>
        pane.querySelector<HTMLElement>(
          ':scope > .pierre-layout-pane-inner > .pierre-layout-content'
        )
      )
      .filter((content) => content !== null);
    const sizes = contents.map((content) => content.getBoundingClientRect());
    contents.forEach((content, index) => {
      content.style.flex = 'none';
      content.style.width = `${sizes[index].width}px`;
      content.style.height = `${sizes[index].height}px`;
      content.style.contain = 'strict';
      content.style.willChange = 'transform';
    });
    work.frozen = [
      ...contents,
      ...waiting.filter((content) => !contents.includes(content)),
    ];
  }

  /** Let frozen content take its new size: at once, or one pane per frame for `settle`. */
  function thawContent(): void {
    const work = resizeWork.current;
    const thaw = (content: HTMLElement): void => {
      content.style.flex = '';
      content.style.width = '';
      content.style.height = '';
      content.style.contain = '';
      content.style.willChange = '';
    };
    if (experimentalResize !== 'settle') {
      work.frozen.forEach(thaw);
      work.frozen = [];
      return;
    }
    work.thawing = [...work.thawing, ...work.frozen];
    work.frozen = [];
    const step = (): void => {
      const next = work.thawing.shift();
      if (next !== undefined) thaw(next);
      work.frame = work.thawing.length > 0 ? requestAnimationFrame(step) : null;
    };
    if (work.frame === null) step();
  }

  /** Apply the ratios of one pointer move with the `experimentalResize` variant. */
  function applyResize(
    active: ResizeGesture,
    ratios: Record<string, number>
  ): void {
    const work = resizeWork.current;
    if (experimentalResize === 'frame') {
      work.pending = ratios;
      work.frame ??= requestAnimationFrame(() => {
        work.frame = null;
        if (work.pending !== null) store.setRatios(work.pending);
        work.pending = null;
      });
      return;
    }
    if (experimentalResize === 'preview') {
      work.pending = ratios;
      const root = rootRef.current;
      const move = (element: HTMLElement, x: number, y: number): void => {
        element.style.transform = `translate(${x}px, ${y}px)`;
        element.dataset.preview = 'true';
        if (!work.moved.includes(element)) work.moved.push(element);
      };
      // The offset of each dragged split, along its own axis.
      const offsets = new Map<string, number>();
      for (const separator of active.separators) {
        const element = root?.querySelector<HTMLElement>(
          `[data-layout-flip="separator:${CSS.escape(separator.split.id)}"]`
        );
        if (element === null || element === undefined) continue;
        const horizontal = separator.split.direction === 'horizontal';
        const available = horizontal
          ? separator.container.width - separator.rect.width
          : separator.container.height - separator.rect.height;
        const offset =
          ((ratios[separator.split.id] ?? separator.ratio) - separator.ratio) *
          available;
        offsets.set(separator.split.id, offset);
        move(element, horizontal ? offset : 0, horizontal ? 0 : offset);
      }
      // A corner moves with the dragged splits that it joins.
      for (const corner of geometry.corners) {
        const [horizontal, vertical] = corner.splitIds;
        if (!offsets.has(horizontal) && !offsets.has(vertical)) continue;
        const element = root?.querySelector<HTMLElement>(
          `[data-layout-corner="${CSS.escape(corner.id)}"]`
        );
        if (element === null || element === undefined) continue;
        move(element, offsets.get(horizontal) ?? 0, offsets.get(vertical) ?? 0);
      }
      return;
    }
    if (experimentalResize === 'freeze' || experimentalResize === 'settle') {
      freezeContent(active.separators);
      if (work.pause !== null) clearTimeout(work.pause);
      work.pause = setTimeout(thawContent, FREEZE_PAUSE_MS);
    }
    store.setRatios(ratios);
  }

  /** End the variant's work. Commit while the gesture is active, so that the last ratios do not animate. */
  function endResize(cancel: boolean): void {
    const work = resizeWork.current;
    if (work.frame !== null && experimentalResize === 'frame')
      cancelAnimationFrame(work.frame);
    if (work.pause !== null) clearTimeout(work.pause);
    if (!cancel && work.pending !== null) store.setRatios(work.pending);
    for (const element of work.moved) {
      element.style.transform = '';
      delete element.dataset.preview;
    }
    work.pending = null;
    work.moved = [];
    work.pause = null;
    if (experimentalResize === 'frame') work.frame = null;
    thawContent();
  }

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
      originalRatios: Object.fromEntries(
        separators.map(({ split }) => [split.id, split.ratio])
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

  function closePane(pane: PaneNode): void {
    if (onPaneClose !== undefined) onPaneClose(pane);
    else store.close(pane.id);
    requestAnimationFrame(() => {
      const focused = store.getSnapshot().focusedPane;
      Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>('[data-layout-pane]') ??
          []
      )
        .find((element) => element.dataset.layoutPane === focused)
        ?.focus();
    });
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>): void {
    const active = gesture.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    if (active.type === 'resize') {
      const ratios: Record<string, number> = {};
      for (const separator of active.separators) {
        const horizontal = separator.split.direction === 'horizontal';
        const available = horizontal
          ? separator.container.width - separator.rect.width
          : separator.container.height - separator.rect.height;
        if (available <= 0) continue;
        const delta = horizontal
          ? event.clientX - active.x
          : event.clientY - active.y;
        ratios[separator.split.id] = Math.max(
          separator.minRatio,
          Math.min(separator.maxRatio, separator.ratio + delta / available)
        );
      }
      applyResize(active, ratios);
    } else {
      if (Math.hypot(event.clientX - active.x, event.clientY - active.y) < 4)
        return;
      setDragging(active.paneId);
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const target = readGeometry().panes.find(
        ({ pane, rect }) =>
          pane.id !== active.paneId &&
          x >= rect.x &&
          x <= rect.x + rect.width &&
          y >= rect.y &&
          y <= rect.y + rect.height
      );
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
    if (active.type === 'resize') endResize(cancel);
    gesture.current = null;
    if (active.type === 'resize' && cancel)
      store.setRatios(active.originalRatios);
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
    const separators = separatorsAt(event.currentTarget, ids);
    const ratios: Record<string, number> = {};
    for (const separator of separators) {
      const horizontal = separator.split.direction === 'horizontal';
      const smaller = horizontal ? 'ArrowLeft' : 'ArrowUp';
      const larger = horizontal ? 'ArrowRight' : 'ArrowDown';
      const step = event.shiftKey ? 0.1 : 0.02;
      const value =
        event.key === smaller
          ? separator.ratio - step
          : event.key === larger
            ? separator.ratio + step
            : event.key === 'Home'
              ? separator.minRatio
              : event.key === 'End'
                ? separator.maxRatio
                : event.key === 'Enter'
                  ? 0.5
                  : null;
      if (value !== null)
        ratios[separator.split.id] = Math.max(
          separator.minRatio,
          Math.min(separator.maxRatio, value)
        );
    }
    if (Object.keys(ratios).length > 0) {
      event.preventDefault();
      store.setRatios(ratios);
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
      {paneHosts.map(({ pane, hidden: collapsed }) => {
        const covered =
          !collapsed &&
          state.zoomedPane !== null &&
          state.zoomedPane !== pane.id;
        const hidden = collapsed || covered;
        const zoomed = state.zoomedPane === pane.id;
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
            aria-label={getPaneTitle(pane)}
            aria-hidden={hidden}
            inert={hidden}
            data-collapsed={collapsed}
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
                    disabled={state.zoomedPane !== null}
                    onPointerDown={(event) => startMove(event, pane.id)}
                  >
                    ⠿
                  </button>
                )}
                <span className="pierre-layout-title">
                  {getPaneTitle(pane)}
                </span>
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
                    disabled={visibleCount === 1}
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
        geometry.separators.map((separator) => (
          <div
            key={separator.split.id}
            className="pierre-layout-separator"
            role="separator"
            tabIndex={0}
            aria-label={`Resize ${shownPanes(separator.split.first).map(getPaneTitle).join(', ')} and ${shownPanes(separator.split.second).map(getPaneTitle).join(', ')}`}
            aria-orientation={
              separator.split.direction === 'horizontal'
                ? 'vertical'
                : 'horizontal'
            }
            aria-controls={shownPanes(separator.split)
              .map(({ id }) => `${prefix}-${encodeURIComponent(id)}`)
              .join(' ')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(separator.split.ratio * 100)}
            aria-valuetext={`${Math.round(separator.split.ratio * 100)}% preferred size`}
            data-direction={separator.split.direction}
            data-layout-flip={`separator:${separator.split.id}`}
            style={styles.separators.get(separator.split.id)}
            onPointerDown={(event) => startResize(event, [separator.split.id])}
            onKeyDown={(event) => resizeKey(event, [separator.split.id])}
          />
        ))}
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
            onPointerDown={(event) => startResize(event, corner.splitIds)}
            onKeyDown={(event) => resizeKey(event, corner.splitIds)}
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
