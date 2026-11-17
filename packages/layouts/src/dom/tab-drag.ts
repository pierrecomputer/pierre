/**
 * DOM work of a tab drag in one tab list. On each pointer move, the view reads
 * the edges of the tabs and moves one drop marker in the top layer of the
 * layout with a transform, so the marker shows above sticky tabs and the
 * app's fades, and a move that keeps its place changes nothing in the page.
 */
import { stuckEnd } from '../stacks-model';

/** The left and right edges of a tab, from the left edge of its tab list. */
export interface TabEdges {
  readonly left: number;
  readonly right: number;
  /** The tab is a stuck pinned tab of `stickyPinned`. */
  readonly sticky: boolean;
}

const MARKER_CLASS = 'pierre-layouts-tab-drop';

export const TABLIST_ATTRIBUTE = 'data-layouts-tablist';
export const TAB_ATTRIBUTE = 'data-layouts-tab';
export const TAB_CLOSE_ATTRIBUTE = 'data-layouts-tab-close';

// The space below a tab list that still belongs to its header band.
const BAND_SLACK_PX = 8;

// The width at each visible end of a tab list where a drag scrolls it, and
// the most pixels that it scrolls in a frame.
const SCROLL_ZONE_PX = 32;
const SCROLL_STEP_PX = 12;

export function tabsOf(tablist: HTMLElement): HTMLElement[] {
  return Array.from(
    tablist.querySelectorAll<HTMLElement>(`[${TAB_ATTRIBUTE}]`)
  ).filter((tab) => tab.closest(`[${TABLIST_ATTRIBUTE}]`) === tablist);
}

/** The edges of each tab of a tab list as it shows, in order. */
export function readTabEdges(tablist: HTMLElement): TabEdges[] {
  const origin = tablist.getBoundingClientRect().left;
  return tabsOf(tablist).map((tab) => {
    const box = tab.getBoundingClientRect();
    return {
      left: box.left - origin,
      right: box.right - origin,
      sticky: tab.hasAttribute('data-sticky'),
    };
  });
}

/**
 * The tab list of a pane host while the pointer is in its header band: from
 * the top of the host to a few pixels below the tab list. In the band, a drag
 * drops into the tab list, and the preview of a place in the pane starts only
 * when the pointer leaves the band.
 */
export function tablistInBand(
  host: HTMLElement,
  clientY: number
): HTMLElement | null {
  const tablist = host.querySelector<HTMLElement>(`[${TABLIST_ATTRIBUTE}]`);
  if (tablist === null) return null;
  return clientY >= host.getBoundingClientRect().top &&
    clientY <= tablist.getBoundingClientRect().bottom + BAND_SLACK_PX
    ? tablist
    : null;
}

/**
 * The place of a drop before tab `boundary`, or after the last, from the left
 * edge of the tab list. A place after the pinned run shows at the end of the
 * run at the least, as the tabs that scroll under the run are under it.
 */
export function boundaryOffset(
  edges: readonly TabEdges[],
  boundary: number
): number {
  if (edges.length === 0) return 0;
  const at = boundary === 0 ? edges[0].left : edges[boundary - 1].right;
  return edges[boundary - 1]?.sticky === true ||
    edges[boundary]?.sticky === true
    ? at
    : Math.max(at, stuckEnd(edges));
}

/**
 * The pixels that a drag scrolls a tab list in a frame while the pointer is
 * `x` pixels from its left edge: forward near or past its right end, back
 * near its left end, after the stuck pinned tabs, and 0 elsewhere.
 */
export function edgeScroll(
  tablist: HTMLElement,
  edges: readonly TabEdges[],
  x: number
): number {
  const start = stuckEnd(edges);
  const width = tablist.clientWidth;
  const step = (depth: number): number =>
    Math.ceil(
      (SCROLL_STEP_PX * Math.min(depth, SCROLL_ZONE_PX)) / SCROLL_ZONE_PX
    );
  if (
    x > width - SCROLL_ZONE_PX &&
    tablist.scrollLeft < tablist.scrollWidth - width - 1
  )
    return step(x - width + SCROLL_ZONE_PX);
  if (
    x < start + SCROLL_ZONE_PX &&
    (start === 0 || x >= start) &&
    tablist.scrollLeft > 0
  )
    return -step(start + SCROLL_ZONE_PX - x);
  return 0;
}

/**
 * Show the drop marker of a tab list at `offset` pixels from its left edge,
 * kept inside the list's box, in the top layer of the layout `root`.
 */
export function showTabDrop(
  root: HTMLElement,
  tablist: HTMLElement,
  offset: number
): void {
  let marker = root.querySelector<HTMLElement>(`:scope > .${MARKER_CLASS}`);
  if (marker === null) {
    marker = document.createElement('span');
    marker.className = MARKER_CLASS;
    marker.setAttribute('aria-hidden', 'true');
    root.append(marker);
  }
  const area = root.getBoundingClientRect();
  const box = tablist.getBoundingClientRect();
  const x = box.left - area.left + Math.min(Math.max(offset, 0), box.width);
  marker.style.transform = `translate(${x}px, ${box.top - area.top + 6}px)`;
  marker.style.height = `${Math.max(0, box.height - 12)}px`;
}

/** Remove the drop marker of a layout. */
export function clearTabDrop(root: HTMLElement): void {
  root.querySelector(`:scope > .${MARKER_CLASS}`)?.remove();
}
