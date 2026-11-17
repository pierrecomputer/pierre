'use client';

// One drag engine for the layout: a pointer gesture that moves a source over
// the panes, the drop target under the pointer, and the preview of the drop.
// The engine does not depend on the kind of the source: a pane and a tab use
// the same gesture, targets, and preview, and an app's own source can use
// them later. A source tells which places it takes: the edges of a pane, or
// also the center of a pane and the tab lists (a drop into a stack).
import { type PointerEvent, type ReactNode, useSyncExternalStore } from 'react';

import {
  type DropPlace,
  dropPlace,
  dropTarget,
  paneAt,
  placeRect,
} from '../drop';
import { type ContextOfStore, STORE_CONTEXT } from '../store';
import { treeIndex } from '../tree-index';
import type { LayoutGeometry, Place, Rect } from '../types';
import type { ViewContext } from './contract';

/** What a drag moves. */
export interface DragSource {
  /** The kind of the source, for example `pane` or `tab`. */
  readonly kind: string;
  /** The ID of the pane that moves. */
  readonly id: string;
}

/** Where a drag drops. */
export interface DropTarget {
  readonly paneId: string;
  readonly place: DropPlace;
  /** The box of the place in the layout, or null for a place in a tab list. */
  readonly rect: Rect | null;
  /** For a place in a tab list: the boundary among its tabs, from 0 to their count. */
  readonly boundary?: number;
  /** For a place in a tab list: the IDs of the panes of its tabs, in order. */
  readonly tabs?: readonly string[];
}

/**
 * The layout's rule for places (`canPlace` of `createLayout`), for a pane
 * that a drag puts in a place: false when the rule refuses it.
 */
export function allowsPlace(
  context: ViewContext,
  id: string,
  place: Place
): boolean {
  const store = (context.store as unknown as ContextOfStore)[STORE_CONTEXT];
  const pane = treeIndex(store.get().root).panes.get(id)?.pane;
  return pane !== undefined && store.canPlace(pane, place);
}

/** A drag that runs: its source, and its drop target, or null. */
export interface Drag {
  readonly source: DragSource;
  readonly target: DropTarget | null;
}

/** How a drag starts. */
export interface DragOptions {
  readonly source: DragSource;
  /** The source can drop into a stack: at the center of a pane, or in a tab list. */
  readonly center?: boolean;
  /**
   * The panes of the stack of the source, the source included. On one of
   * them, the source drops at an edge, beside the stack, or in its tab list.
   */
  readonly group?: readonly string[];
  /**
   * False when the panes cannot be rearranged, for example while a pane
   * fills the layout: then only the tab list of the source's own stack takes
   * a drop.
   */
  readonly rearrange?: boolean;
  /**
   * The target to use for a target under the pointer: the same target, a
   * target with another boundary in its tab list, or null to refuse it. A
   * refused target shows no marker and no preview, and takes no drop.
   */
  accept?(target: DropTarget): DropTarget | null;
  /**
   * A wait before the drag starts, such as the still press of a touch drag:
   * it gets the press and a function that starts the drag, and returns the
   * wait, or undefined for no wait.
   */
  readonly wait?: (
    press: PointerEvent<HTMLElement>,
    begin: () => void
  ) => DragWait | undefined;
  /** The drops in the tab lists, for a source that can drop into a stack. */
  readonly band?: DragBand;
  /** The pointer moved to a point of the layout, during the drag. */
  follow?(x: number, y: number): void;
  /** Apply the drop. */
  drop(target: DropTarget): void;
}

// The key of the drag in the view state.
const DRAG = 'drag';

/** A wait before a drag starts. */
export interface DragWait {
  /**
   * The pointer moved this far from the press: true when the drag takes the
   * move, false while the drag waits or after the wait gave up.
   */
  move(distance: number): boolean;
  /** The press ends. */
  end(): void;
}

// A press becomes a drag after the pointer moves this far.
const DRAG_THRESHOLD_PX = 4;

/**
 * The drop target in the area of a pane, at a point of the layout. A source
 * that drops only beside a pane takes the nearest edge; a source that can
 * drop into a stack takes the center of the pane too. On the source's own
 * stack, the source drops at an edge only, beside the stack.
 */
export function dropTargetAt(
  geometry: LayoutGeometry,
  x: number,
  y: number,
  options: DragOptions
): DropTarget | null {
  const { group, source } = options;
  const hit = paneAt(geometry, x, y, group === undefined ? source.id : '');
  if (hit === undefined) return null;
  let place: DropPlace;
  let rect: Rect;
  if (options.center === true) {
    place = dropPlace(hit.rect, x, y);
    rect = placeRect(hit.rect, place);
  } else ({ edge: place, rect } = dropTarget(hit.pane.id, hit.rect, x, y));
  let paneId = hit.pane.id;
  if (group?.includes(paneId) === true) {
    const sibling =
      paneId === source.id ? group.find((id) => id !== source.id) : paneId;
    if (place === 'center' || sibling === undefined) return null;
    paneId = sibling;
  }
  return { paneId, place, rect };
}

/**
 * A drop in a tab list while the pointer is in the header band of its pane:
 * the target, or null when the source's rule refuses it, the tab list, and
 * the pixels that the list scrolls in a frame while the pointer stays.
 */
export interface BandTarget {
  readonly target: DropTarget | null;
  readonly tablist: HTMLElement;
  readonly scroll: number;
}

/**
 * The drops of a source in the tab lists, which `tabDrag()` gives, so a
 * layout with only pane drags has no code for tab lists.
 */
export interface DragBand {
  /** The drop at a point in the header band of a pane, or null outside a band. */
  at(
    element: HTMLElement,
    geometry: LayoutGeometry,
    point: { x: number; y: number; clientX: number; clientY: number },
    options: DragOptions
  ): BandTarget | null;
  /** Show the marker of a drop in a tab list in the layout, or no marker. */
  mark(element: HTMLElement, band: BandTarget | null): void;
}

// The target that a source takes for a target under the pointer, or null.
export const accepted = (
  options: DragOptions,
  target: DropTarget | null
): DropTarget | null =>
  target === null || options.accept === undefined
    ? target
    : options.accept(target);

const sameTarget = (a: DropTarget | null, b: DropTarget | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.paneId === b.paneId &&
    a.place === b.place &&
    a.boundary === b.boundary);

/** Stop the click that the browser sends after a drag, which is not a press. */
function swallowNextClick(): void {
  const swallow = (event: Event): void => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  // A release outside the element sends no click.
  setTimeout(() => window.removeEventListener('click', swallow, true), 0);
}

/**
 * Start a drag from a pointer press. The drag starts when the pointer moves
 * 4 pixels, or when a `wait` starts it; a press without a move stays a click.
 * The view state holds the drag while it runs, and changes only when the drop
 * target changes. A release drops; Escape, a cancel, or an unmount ends the
 * drag with no drop.
 */
export function startDrag(
  context: ViewContext,
  event: PointerEvent<HTMLElement>,
  options: DragOptions
): void {
  if (event.button !== 0) return;
  // The source's rule runs once for each target under the pointer.
  const accept = options.accept;
  let asked: DropTarget | null = null;
  let answer: DropTarget | null = null;
  const rules: DragOptions =
    accept === undefined
      ? options
      : {
          ...options,
          accept(next) {
            if (!sameTarget(next, asked)) {
              asked = next;
              answer = accept(next);
            }
            return answer;
          },
        };
  const handle = event.currentTarget;
  const { pointerId, clientX, clientY } = event;
  let started = false;
  let target: DropTarget | null = null;
  const capture = (): void => {
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // The pointer is no longer active; the next event ends the gesture.
    }
  };
  const wait = options.wait?.(event, () => {
    started = true;
    capture();
    context.view.set({ [DRAG]: { source: options.source, target } });
  });
  // The last point of the pointer, and the frame of the scroll of a tab list
  // while the pointer stays near one of its ends.
  let point = { clientX, clientY };
  let frame = 0;
  // Find the target at the last point, move the marker, and keep a tab list
  // scrolling while the pointer is near one of its ends.
  const track = (): void => {
    const element = context.element();
    if (element === null) return;
    const bounds = element.getBoundingClientRect();
    const x = point.clientX - bounds.left;
    const y = point.clientY - bounds.top;
    options.follow?.(x, y);
    const geometry = context.readGeometry();
    const band =
      options.band?.at(element, geometry, { x, y, ...point }, rules) ?? null;
    options.band?.mark(element, band);
    if (band !== null && band.scroll !== 0 && frame === 0)
      frame = requestAnimationFrame(() => {
        frame = 0;
        band.tablist.scrollLeft += band.scroll;
        track();
      });
    const next =
      band !== null
        ? band.target
        : options.rearrange === false
          ? null
          : accepted(rules, dropTargetAt(geometry, x, y, rules));
    if (started && sameTarget(next, target)) return;
    started = true;
    target = next;
    context.view.set({ [DRAG]: { source: options.source, target } });
  };
  context.startGesture({
    pointerId,
    move(move) {
      const distance = Math.hypot(
        move.clientX - clientX,
        move.clientY - clientY
      );
      if (
        wait?.move(distance) === false ||
        (!started && distance < DRAG_THRESHOLD_PX)
      )
        return;
      if (!started) capture();
      point = { clientX: move.clientX, clientY: move.clientY };
      track();
    },
    end(cancel) {
      wait?.end();
      cancelAnimationFrame(frame);
      if (handle.hasPointerCapture?.(pointerId))
        handle.releasePointerCapture(pointerId);
      const element = context.element();
      if (element !== null) options.band?.mark(element, null);
      if (!started) return;
      swallowNextClick();
      context.view.set({ [DRAG]: null });
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

/** The preview of a drop in the area of a pane, for the sources of one kind. */
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
      className="pierre-layouts-drop"
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
