'use client';

// One drag engine for the layout: a pointer gesture that moves a source over
// the panes, the drop target under the pointer, and the preview of the drop.
// The engine does not depend on the kind of the source: a pane and a tab use
// the same gesture, targets, and preview, and an app's own source can use
// them later.
import { type PointerEvent, type ReactNode, useSyncExternalStore } from 'react';

import {
  type DropPlace,
  dropPlace,
  dropTarget,
  paneAt,
  placeRect,
} from '../drop';
import type { LayoutGeometry, Rect } from '../types';
import type { ViewContext } from './contract';

/** What a drag moves. */
export interface DragSource {
  /** The kind of the source, for example `pane` or `tab`. */
  readonly kind: string;
  /** The ID of the pane that moves. */
  readonly id: string;
}

/** Where a drag drops: a pane, a place at its edges or its center, and the box of the place. */
export interface DropTarget {
  readonly paneId: string;
  readonly place: DropPlace;
  readonly rect: Rect;
}

/** A drag that runs: its source, and its drop target, or null. */
export interface Drag {
  readonly source: DragSource;
  readonly target: DropTarget | null;
}

/** How a drag starts. */
export interface DragOptions {
  readonly source: DragSource;
  /** The source can drop at the center of a pane, into its stack. */
  readonly center?: boolean;
  /** The panes that the source does not drop on, besides itself. */
  readonly exclude?: readonly string[];
  /** Apply the drop. */
  drop(target: DropTarget): void;
}

// The key of the drag in the view state.
const DRAG = 'drag';

// A press becomes a drag after the pointer moves this far.
const DRAG_THRESHOLD_PX = 4;

/**
 * The drop target at a point of the layout: the pane under the point, and
 * the place in it. A source that drops only beside a pane takes the nearest
 * edge; a source that can drop into a stack takes the center of the pane too.
 */
export function dropTargetAt(
  geometry: LayoutGeometry,
  x: number,
  y: number,
  options: DragOptions
): DropTarget | null {
  const hit = paneAt(geometry, x, y, options.source.id);
  if (hit === undefined || options.exclude?.includes(hit.pane.id) === true)
    return null;
  if (options.center !== true) {
    const { edge, rect } = dropTarget(hit.pane.id, hit.rect, x, y);
    return { paneId: hit.pane.id, place: edge, rect };
  }
  const place = dropPlace(hit.rect, x, y);
  return { paneId: hit.pane.id, place, rect: placeRect(hit.rect, place) };
}

const sameTarget = (a: DropTarget | null, b: DropTarget | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.paneId === b.paneId && a.place === b.place);

/**
 * Start a drag from a pointer press. The drag starts when the pointer moves
 * 4 pixels. The view state holds it while it runs, and changes only when the
 * drop target changes. A release drops; Escape, a cancel, or an unmount ends
 * the drag with no drop.
 */
export function startDrag(
  context: ViewContext,
  event: PointerEvent<HTMLElement>,
  options: DragOptions
): void {
  if (event.button !== 0) return;
  const handle = event.currentTarget;
  const { pointerId, clientX, clientY } = event;
  handle.setPointerCapture(pointerId);
  let started = false;
  let target: DropTarget | null = null;
  context.startGesture({
    pointerId,
    move(move) {
      if (
        !started &&
        Math.hypot(move.clientX - clientX, move.clientY - clientY) <
          DRAG_THRESHOLD_PX
      )
        return;
      const element = context.element();
      if (element === null) return;
      const bounds = element.getBoundingClientRect();
      const next = dropTargetAt(
        context.readGeometry(),
        move.clientX - bounds.left,
        move.clientY - bounds.top,
        options
      );
      if (started && sameTarget(next, target)) return;
      started = true;
      target = next;
      context.view.set({ [DRAG]: { source: options.source, target } });
    },
    end(cancel) {
      if (handle.hasPointerCapture?.(pointerId))
        handle.releasePointerCapture(pointerId);
      if (started) context.view.set({ [DRAG]: null });
      if (!cancel && target !== null) options.drop(target);
    },
  });
}

/** A value of the drag of a view; the component renders when it changes. */
export function useDrag<T>(
  context: ViewContext,
  select: (drag: Drag | null) => T
): T {
  const get = () =>
    select((context.view.get()[DRAG] as Drag | null | undefined) ?? null);
  return useSyncExternalStore(context.view.subscribe, get, get);
}

/** The preview of a drop: the box where the source of a kind would go. */
export function DropPreview({
  context,
  kind,
}: {
  context: ViewContext;
  kind: string;
}): ReactNode {
  const rect = useDrag(context, (drag) =>
    drag?.source.kind === kind ? (drag.target?.rect ?? null) : null
  );
  return rect === null ? null : (
    <div
      className="pierre-layout-drop"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
      aria-hidden="true"
    />
  );
}
