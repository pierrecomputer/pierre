'use client';

import {
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { computeCSSLayout, type CSSRect } from '../css-layout';
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

  // Animate model changes only. CSS owns continuous sizing, including while JS is busy.
  const subscribe = useCallback(
    (listener: () => void): (() => void) => {
      let previousZoom = store.getSnapshot().zoomedPane;
      let animationTimer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = store.subscribe(() => {
        const element = rootRef.current;
        const zoom = store.getSnapshot().zoomedPane;
        if (element !== null) {
          if (zoom !== previousZoom && zoom !== null) {
            const bounds = element.getBoundingClientRect();
            const edges: Record<string, Edge> = {};
            for (const pane of element.querySelectorAll<HTMLElement>(
              '[data-layout-pane]'
            )) {
              const box = pane.getBoundingClientRect();
              const id = pane.dataset.layoutPane;
              if (id !== undefined)
                edges[id] = getExitEdge(
                  {
                    x: box.left - bounds.left,
                    y: box.top - bounds.top,
                    width: box.width,
                    height: box.height,
                  },
                  bounds.width,
                  bounds.height
                );
            }
            setExitEdges(edges);
          }
          element.dataset.animating = 'true';
          clearTimeout(animationTimer);
          animationTimer = setTimeout(() => {
            delete element.dataset.animating;
          }, 260);
        }
        previousZoom = zoom;
        listener();
      });
      return () => {
        unsubscribe();
        clearTimeout(animationTimer);
      };
    },
    [store]
  );
  const state = useSyncExternalStore(
    subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const geometry = computeCSSLayout(state.root, gap);
  // Keep DOM order independent of tree traversal: detach/reinsert can reset scroll and focus.
  const paneHosts = [...geometry.panes].sort((a, b) =>
    a.pane.id < b.pane.id ? -1 : a.pane.id > b.pane.id ? 1 : 0
  );
  const focused = geometry.panes.find(
    ({ pane }) => pane.id === (state.zoomedPane ?? state.focusedPane)
  );

  useEffect(() => {
    const element = rootRef.current;
    if (element === null) return;
    // Observation only cancels a discrete animation; it never computes bounds or updates React.
    const observer = new ResizeObserver(() => {
      delete element.dataset.animating;
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
      style={{ ...geometry.variables, ...style }}
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
      {paneHosts.map(({ pane, rect }) => {
        const hidden =
          state.zoomedPane !== null && state.zoomedPane !== pane.id;
        const zoomed = state.zoomedPane === pane.id;
        const edge = exitEdges[pane.id] ?? 'left';
        const hiddenRect: CSSRect = {
          ...rect,
          ...(edge === 'left'
            ? { left: `calc(0px - ${rect.width} - ${gap}px)` }
            : edge === 'right'
              ? { left: `calc(100cqw + ${gap}px)` }
              : edge === 'top'
                ? { top: `calc(0px - ${rect.height} - ${gap}px)` }
                : { top: `calc(100cqh + ${gap}px)` }),
        };
        return (
          <section
            key={pane.id}
            id={`${prefix}-${encodeURIComponent(pane.id)}`}
            data-layout-pane={pane.id}
            className="pierre-layout-pane"
            tabIndex={hidden ? -1 : 0}
            aria-label={getPaneTitle(pane)}
            aria-hidden={hidden}
            inert={hidden}
            data-focused={state.focusedPane === pane.id}
            data-zoomed={zoomed}
            data-moving={dragging === pane.id}
            style={{
              ...(zoomed
                ? { left: 0, top: 0, width: '100%', height: '100%' }
                : hidden
                  ? hiddenRect
                  : rect),
            }}
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
            <div className="pierre-layout-content">{renderPane(pane)}</div>
          </section>
        );
      })}
      {focused !== undefined && (
        <div
          className="pierre-layout-focus"
          aria-hidden="true"
          style={
            state.zoomedPane !== null
              ? { left: 0, top: 0, width: '100%', height: '100%' }
              : focused.rect
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
            style={separator.rect}
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
            style={{ left: corner.left, top: corner.top }}
            data-layout-corner={corner.id}
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
