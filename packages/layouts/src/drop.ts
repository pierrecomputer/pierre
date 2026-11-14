// Drop targets of a pane drag and a tab drag: the pane under the pointer, the
// place at its edges or center, and the box that shows the drop.
import type { Edge, LayoutGeometry, Rect } from './types';

/** Where a dragged pane goes: beside a pane, at one of its edges, and the box that shows it. */
export interface DropTarget {
  paneId: string;
  edge: Edge;
  rect: Rect;
}

export type DropPlace = Edge | 'center';

export interface TabDropTarget {
  paneId: string;
  place: DropPlace;
  rect: Rect;
}

const EDGE_X_FRACTION = 0.28;

const EDGE_Y_FRACTION = 0.3;

/** The pane under a point of the layout, other than the pane that moves. */
export function paneAt(
  geometry: LayoutGeometry,
  x: number,
  y: number,
  except: string
): LayoutGeometry['panes'][number] | undefined {
  return geometry.panes.find(
    ({ pane, rect }) =>
      pane.id !== except &&
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height
  );
}

/** Pick the closest side of a pane and show exactly where a dragged pane will be inserted. */
export function dropTarget(
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

export function dropPlace(rect: Rect, x: number, y: number): DropPlace {
  const px = rect.width > 0 ? (x - rect.x) / rect.width : 0.5;
  const py = rect.height > 0 ? (y - rect.y) / rect.height : 0.5;
  if (px < EDGE_X_FRACTION) return 'left';
  if (px > 1 - EDGE_X_FRACTION) return 'right';
  if (py < EDGE_Y_FRACTION) return 'top';
  if (py > 1 - EDGE_Y_FRACTION) return 'bottom';
  return 'center';
}

export function placeRect(rect: Rect, place: DropPlace): Rect {
  return {
    x: rect.x + (place === 'right' ? rect.width / 2 : 0),
    y: rect.y + (place === 'bottom' ? rect.height / 2 : 0),
    width: place === 'left' || place === 'right' ? rect.width / 2 : rect.width,
    height:
      place === 'top' || place === 'bottom' ? rect.height / 2 : rect.height,
  };
}

export function tabDropTarget(
  geometry: LayoutGeometry,
  x: number,
  y: number,
  tabId: string,
  group: readonly string[],
  center = false
): TabDropTarget | null {
  const hit = paneAt(geometry, x, y, '');
  if (hit === undefined) return null;
  const place = center ? 'center' : dropPlace(hit.rect, x, y);
  if (!group.includes(hit.pane.id))
    return { paneId: hit.pane.id, place, rect: placeRect(hit.rect, place) };
  const sibling =
    hit.pane.id === tabId ? group.find((id) => id !== tabId) : hit.pane.id;
  if (place === 'center' || sibling === undefined) return null;
  return { paneId: sibling, place, rect: placeRect(hit.rect, place) };
}
