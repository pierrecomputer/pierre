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
import {
  animateFromBoxes,
  cancelFlipAnimations,
  finishFlipAnimations,
  readBoxes,
} from '../dom/flip';
import {
  focusPane,
  focusZoomedPane,
  hideCoveredAfterAnimation,
  notifyCollapsed,
  readPixelGeometry,
  setCoveredHidden,
  splitsAt,
} from '../dom/panes';
import { createResizeWork, type ResizeStrategy } from '../dom/resize-work';
import {
  dragRatios,
  dropTarget,
  type DropTarget,
  getExitEdges,
  keyRatios,
  paneAt,
} from '../gestures';
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

export { PANE_VISIBILITY_EVENT, type PaneVisibilityEvent } from '../dom/panes';
export type { ResizeStrategy } from '../dom/resize-work';

/** A button in a pane header: drag to move, zoom, or close. */
export type PaneAction = 'move' | 'zoom' | 'close';

const ALL_PANE_ACTIONS: readonly PaneAction[] = ['move', 'zoom', 'close'];

export interface LayoutProps {
  store: LayoutStore;
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
   * are few. `true` by default.
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
   * resize applies its ratios (see `ResizeStrategy`).
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
  originalRatios: Record<string, number>;
}

interface MoveGesture {
  type: 'move';
  pointerId: number;
  x: number;
  y: number;
  paneId: string;
}

/** The panes of a subtree that take space. */
const shownPanes = (node: LayoutNode): PaneNode[] =>
  getPanes(node).filter(({ hidden }) => hidden !== true);

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
  paneLayers = true,
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
        // boxes: the focus indicator shows on the new pane at once.
        const treeChanges = next.root !== previous.root;
        const zoomChanges = zoom !== previous.zoomedPane;
        const moves = treeChanges || zoomChanges;
        // Each kind of change in this update must allow animation.
        const allowed =
          (!treeChanges || animateLayout) && (!zoomChanges || animateZoom);
        // A pointer resize follows the pointer with no animation.
        const animate =
          element !== null &&
          moves &&
          allowed &&
          gesture.current?.type !== 'resize' &&
          !matchMedia('(prefers-reduced-motion: reduce)').matches;
        const zoomStarts = zoom !== previous.zoomedPane && zoom !== null;
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
        if (element !== null && zoom !== previous.zoomedPane)
          setCoveredHidden(element, null);
        previous = next;
        listener();
      });
      return unsubscribe;
    },
    [store, animateLayout, animateZoom]
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
  const layered =
    typeof paneLayers === 'boolean'
      ? paneLayers
      : visibleCount >= paneLayers.minPanes;
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
    if (before !== null && element !== null)
      notifyCollapsed(element, before, collapsed);
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
    const touching = splitsAt(element, target, ids, geometry.corners);
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
      const element = rootRef.current;
      if (element !== null) focusPane(element, store.getSnapshot().focusedPane);
    });
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>): void {
    const active = gesture.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    if (active.type === 'resize') {
      const element = rootRef.current;
      if (element === null) return;
      resizeWork.apply(
        element,
        experimentalResize,
        active.separators,
        dragRatios(
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
    const ratios = keyRatios(
      separatorsAt(event.currentTarget, ids),
      event.key,
      event.shiftKey
    );
    if (ratios !== null) {
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
            // A covered pane becomes inert when its content stops rendering,
            // at the end of the zoom animation (setCoveredHidden).
            inert={collapsed}
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
                    // Not `disabled`, and only on the zoomed pane: a state
                    // change on every pane would lay each grip out again.
                    // startMove ignores a drag while a pane is zoomed.
                    aria-disabled={zoomed || undefined}
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
