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
  PaneNode,
  Rect,
  SeparatorGeometry,
} from '../types';

export interface LayoutProps {
  store: LayoutStore;
  renderPane: (pane: PaneNode) => ReactNode;
  getPaneTitle?: (pane: PaneNode) => string;
  className?: string;
  style?: CSSProperties;
  gap?: number;
  /** Accessible name of the workspace. */
  label?: string;
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

interface DropTarget {
  paneId: string;
  edge: Edge;
  rect: Rect;
}

// Elements that animate a layout change carry this attribute with a stable key.
const FLIP_ATTRIBUTE = 'data-layout-flip';
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
  for (const element of root.querySelectorAll<HTMLElement>(
    `[${FLIP_ATTRIBUTE}]`
  )) {
    const box = element.getBoundingClientRect();
    boxes.set(element.getAttribute(FLIP_ATTRIBUTE) ?? '', {
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

/**
 * FLIP: each element already has its final geometry. Animate it from its old box
 * with a transform only, so that the compositor runs the animation and content
 * lays out once. `transform-origin` is `0 0` on these elements.
 */
function animateFromBoxes(root: HTMLElement, before: Map<string, Rect>): void {
  const duration = durationOf(root);
  const bounds = root.getBoundingClientRect();
  // Read every box before the first animation starts: a new animation dirties
  // style, and a read after it would force another layout.
  const plans: { element: HTMLElement; start: DOMMatrix; end: DOMMatrix }[] =
    [];
  for (const element of root.querySelectorAll<HTMLElement>(
    `[${FLIP_ATTRIBUTE}]`
  )) {
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
  for (const { element, start, end } of plans) {
    element.animate(
      [{ transform: start.toString() }, { transform: end.toString() }],
      { duration, easing: FLIP_EASING, id: FLIP_ANIMATION_ID }
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

// Geometry variables are named by box index: `--layout-box-<index>-<side>`.
const BOX_SIDES = ['left', 'top', 'width', 'height'] as const;
// Registering a property restyles the whole document, so the view registers
// names in blocks before it needs them, not one box at a time.
const REGISTRATION_BLOCK = 256;
let registeredBoxes = 0;

/**
 * Register the geometry variables as `<length>` properties that do not
 * inherit. Each element carries the variables of its own geometry, so a ratio
 * change does not recalculate the style of pane content through inheritance.
 */
function registerGeometryVariables(boxes: number): void {
  if (boxes <= registeredBoxes) return;
  if (typeof CSS === 'undefined' || !('registerProperty' in CSS)) return;
  const target = Math.ceil(boxes / REGISTRATION_BLOCK) * REGISTRATION_BLOCK;
  for (let index = registeredBoxes; index < target; index++) {
    for (const side of BOX_SIDES) {
      try {
        // A typed property computes to pixels, so a variable that refers to
        // another one does not carry its whole calc() expression along.
        CSS.registerProperty({
          name: `--layout-box-${index}-${side}`,
          syntax: '<length>',
          inherits: false,
          initialValue: '0px',
        });
      } catch {
        // Another copy of the view on the page registered it already.
      }
    }
  }
  registeredBoxes = target;
}

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

  // Animate model changes only. CSS owns continuous sizing, including while JS is busy.
  const subscribe = useCallback(
    (listener: () => void): (() => void) => {
      let previousZoom = store.getSnapshot().zoomedPane;
      const unsubscribe = store.subscribe(() => {
        const element = rootRef.current;
        const zoom = store.getSnapshot().zoomedPane;
        // A pointer resize follows the pointer with no animation.
        const animate =
          element !== null &&
          gesture.current?.type !== 'resize' &&
          !matchMedia('(prefers-reduced-motion: reduce)').matches;
        const zoomStarts = zoom !== previousZoom && zoom !== null;
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
        previousZoom = zoom;
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
  registerGeometryVariables(
    Object.keys(geometry.variables).length / BOX_SIDES.length
  );
  // Keep DOM order independent of tree traversal: detach/reinsert can reset scroll and focus.
  const paneHosts = [...geometry.panes].sort((a, b) =>
    a.pane.id < b.pane.id ? -1 : a.pane.id > b.pane.id ? 1 : 0
  );
  const focused = geometry.panes.find(
    ({ pane }) => pane.id === (state.zoomedPane ?? state.focusedPane)
  );

  // After React commits a store change, animate each moved element from its old box.
  useLayoutEffect(() => {
    const element = rootRef.current;
    const before = boxesBefore.current;
    boxesBefore.current = null;
    if (element !== null && before !== null) animateFromBoxes(element, before);
  }, [state]);

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

  useEffect(() => {
    const element = rootRef.current;
    if (element === null || state.zoomedPane === null) return;
    const panes = Array.from(
      element.querySelectorAll<HTMLElement>('[data-layout-pane]')
    );
    const activePane = panes.find((pane) =>
      pane.contains(document.activeElement)
    );
    if (activePane?.dataset.layoutPane !== state.zoomedPane) {
      panes
        .find((pane) => pane.dataset.layoutPane === state.zoomedPane)
        ?.focus();
    }
  }, [state.zoomedPane]);

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

  function closePane(id: string): void {
    store.close(id);
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
      store.setRatios(ratios);
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
      {paneHosts.map(({ pane, rect, variables }) => {
        const hidden =
          state.zoomedPane !== null && state.zoomedPane !== pane.id;
        const zoomed = state.zoomedPane === pane.id;
        const edge = exitEdges[pane.id] ?? 'left';
        // A covered pane keeps its geometry and moves past an edge with a
        // transform, so that it does not lay out its content again.
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
            data-focused={state.focusedPane === pane.id}
            data-zoomed={zoomed}
            data-moving={dragging === pane.id}
            style={
              zoomed
                ? { left: 0, top: 0, width: '100%', height: '100%' }
                : hidden
                  ? {
                      ...variables,
                      ...rect,
                      transform: exit,
                    }
                  : {
                      ...variables,
                      ...rect,
                    }
            }
            onFocusCapture={() => store.focusPane(pane.id)}
            onPointerDown={() => store.focusPane(pane.id)}
          >
            <header className="pierre-layout-header">
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
              <span className="pierre-layout-title">{getPaneTitle(pane)}</span>
              <button
                type="button"
                aria-label={`${zoomed ? 'Restore' : 'Zoom'} ${getPaneTitle(pane)}`}
                aria-pressed={zoomed}
                onClick={() => store.toggleZoom(pane.id)}
              >
                {zoomed ? '↙' : '↗'}
              </button>
              <button
                type="button"
                aria-label={`Close ${getPaneTitle(pane)}`}
                disabled={geometry.panes.length === 1}
                onClick={() => closePane(pane.id)}
              >
                ×
              </button>
            </header>
            <PaneBody pane={pane} renderPane={renderPane} />
          </section>
        );
      })}
      {focused !== undefined && (
        <div
          className="pierre-layout-focus"
          data-layout-flip="focus"
          aria-hidden="true"
          style={
            state.zoomedPane !== null
              ? { left: 0, top: 0, width: '100%', height: '100%' }
              : {
                  ...focused.variables,
                  ...focused.rect,
                }
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
            aria-label={`Resize ${getPanes(separator.split.first).map(getPaneTitle).join(', ')} and ${getPanes(separator.split.second).map(getPaneTitle).join(', ')}`}
            aria-orientation={
              separator.split.direction === 'horizontal'
                ? 'vertical'
                : 'horizontal'
            }
            aria-controls={getPanes(separator.split)
              .map(({ id }) => `${prefix}-${encodeURIComponent(id)}`)
              .join(' ')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(separator.split.ratio * 100)}
            aria-valuetext={`${Math.round(separator.split.ratio * 100)}% preferred size`}
            data-direction={separator.split.direction}
            data-layout-flip={`separator:${separator.split.id}`}
            style={{
              ...separator.variables,
              ...separator.rect,
            }}
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
            style={{
              ...corner.variables,
              left: corner.left,
              top: corner.top,
            }}
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
            : `${geometry.panes.length} panes`}
      </span>
    </div>
  );
}
