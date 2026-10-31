import { computeLayout } from '../geometry';
import type { LayoutGeometry, LayoutNode } from '../types';
import { flipAnimations } from './flip';

/**
 * DOM operations on pane hosts. The view writes these attributes and moves
 * the focus itself, outside its renders, for two reasons: a render of every
 * pane host for a state that only some hosts change would cost more, and some
 * changes must happen in a set order, for example `inert` in the same style
 * update as `content-visibility`.
 */

/**
 * The event that a pane host receives when its content stops or starts
 * rendering. `detail.hidden` is true when the zoom animation of another pane
 * ends, or when the pane is hidden, and false before the pane shows again.
 */
export const PANE_VISIBILITY_EVENT = 'pierre-layout-visibility';
export type PaneVisibilityEvent = CustomEvent<{ hidden: boolean }>;

/**
 * The pane hosts of a layout root. They are children of the root, so this
 * does not walk the pane content, as a query of the subtree would.
 */
export function paneHosts(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.layoutPane !== undefined
  );
}

function notify(host: HTMLElement, hidden: boolean): void {
  host.dispatchEvent(
    new CustomEvent(PANE_VISIBILITY_EVENT, { detail: { hidden } })
  );
}

/**
 * Hide each pane host that the zoomed pane covers, or show every host when
 * `zoomedPane` is null. A style rule gives a hidden host
 * `content-visibility: hidden`. Each host whose state changes receives
 * `PANE_VISIBILITY_EVENT`.
 */
export function setCoveredHidden(
  root: HTMLElement,
  zoomedPane: string | null
): void {
  for (const host of paneHosts(root)) {
    // A hidden pane does not render whatever the zoom.
    if (host.dataset.collapsed === 'true') continue;
    const hidden =
      zoomedPane !== null && host.dataset.layoutPane !== zoomedPane;
    if ((host.dataset.hidden === 'true') === hidden) continue;
    // `inert` is inherited, so on a pane whose content renders it lays out
    // all of that content again (about 200 ms for 15 panes of real content).
    // It changes with `content-visibility` in one style update, so the
    // content does not render for either change.
    if (hidden) {
      host.dataset.hidden = 'true';
      host.inert = true;
    } else {
      host.inert = false;
      delete host.dataset.hidden;
    }
    notify(host, hidden);
  }
}

/**
 * Hide the covered panes when the running zoom animation ends. `isCurrent`
 * tells whether that zoom still holds: a tree change during the zoom cancels
 * its animations, and a new zoom change replaces it.
 */
export function hideCoveredAfterAnimation(
  root: HTMLElement,
  zoomedPane: string,
  isCurrent: () => boolean
): void {
  void Promise.allSettled(
    flipAnimations(root).map((animation) => animation.finished)
  ).then(() => {
    if (isCurrent()) setCoveredHidden(root, zoomedPane);
  });
}

/** Send `PANE_VISIBILITY_EVENT` to each pane that `store.setHidden` hid or showed. */
export function notifyCollapsed(
  root: HTMLElement,
  before: ReadonlySet<string>,
  after: ReadonlySet<string>
): void {
  for (const host of paneHosts(root)) {
    const id = host.dataset.layoutPane ?? '';
    if (after.has(id) !== before.has(id)) notify(host, after.has(id));
  }
}

/** Focus a pane host. */
export function focusPane(root: HTMLElement, id: string): void {
  paneHosts(root)
    .find((host) => host.dataset.layoutPane === id)
    ?.focus();
}

/**
 * Move the focus into the zoomed pane, unless it is there already: a focused
 * element in a pane with `content-visibility: hidden` loses the focus to `body`.
 */
export function focusZoomedPane(root: HTMLElement, id: string): void {
  const active = paneHosts(root).find((host) =>
    host.contains(document.activeElement)
  );
  if (active?.dataset.layoutPane !== id) focusPane(root, id);
}

/**
 * The separators that a pointer or key on a separator or a corner resizes.
 * Corners that sit at the same point join their separators, so that one drag
 * moves all the separators that meet there.
 */
export function separatorIdsAt(
  root: HTMLElement,
  target: HTMLElement,
  ids: readonly string[],
  corners: readonly { id: string; separatorIds: readonly string[] }[]
): Set<string> {
  const touching = new Set(ids);
  if (!target.classList.contains('pierre-layout-corner')) return touching;
  const bounds = target.getBoundingClientRect();
  for (const corner of root.querySelectorAll<HTMLElement>(
    ':scope > [data-layout-corner]'
  )) {
    const other = corner.getBoundingClientRect();
    if (Math.abs(bounds.x - other.x) < 1 && Math.abs(bounds.y - other.y) < 1) {
      const spec = corners.find(({ id }) => id === corner.dataset.layoutCorner);
      for (const id of spec?.separatorIds ?? []) touching.add(id);
    }
  }
  return touching;
}

/** Pixel geometry at the root's current size, for a gesture that starts. */
export function readPixelGeometry(
  root: HTMLElement,
  tree: LayoutNode,
  gap: number
): LayoutGeometry {
  const bounds = root.getBoundingClientRect();
  return computeLayout(tree, bounds.width, bounds.height, gap);
}
