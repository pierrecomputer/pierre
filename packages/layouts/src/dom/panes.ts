import { computeLayout } from '../geometry';
import type { LayoutGeometry, LayoutNode } from '../types';

/**
 * DOM operations on pane hosts. The view writes these attributes and moves
 * the focus itself, outside its renders, for two reasons: a render of every
 * pane host for a state that only some hosts change would cost more, and some
 * changes must happen in a set order, for example `inert` in the same style
 * update as `content-visibility`.
 */

export {
  PANE_VISIBILITY_EVENT,
  type PaneVisibilityEvent,
} from './pane-visibility-event';

/**
 * The pane hosts of a layout root. They are children of the root, so this
 * does not walk the pane content, as a query of the subtree would.
 */
export function paneHosts(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasAttribute('data-layouts-pane')
  );
}

/** Find a pane host among the layout's direct children. */
export function hostOf(root: HTMLElement, id: string): HTMLElement | undefined {
  return paneHosts(root).find(
    (host) => host.getAttribute('data-layouts-pane') === id
  );
}

/** Focus a pane host. */
export function focusPane(root: HTMLElement, id: string): void {
  hostOf(root, id)?.focus();
}

/** Focus the tab of a pane in the header of the pane's own host. */
export function focusTab(root: HTMLElement, id: string): void {
  hostOf(root, id)
    ?.querySelector<HTMLElement>(
      `[data-layouts-tab="${CSS.escape(id)}"][aria-selected="true"]`
    )
    ?.focus();
}

/** Capture the focused pane before a zoom can hide it and move focus to body. */
export function focusOwner(root: HTMLElement): string | null {
  const active = document.activeElement;
  if (active === null || !root.contains(active)) return null;
  const host = paneHosts(root).find((pane) => pane.contains(active));
  return host?.getAttribute('data-layouts-pane') ?? '';
}

/** Move focus out of a covered pane without taking focus from outside the layout. */
export function focusZoomedPane(
  root: HTMLElement,
  id: string,
  owner: string | null
): void {
  if (owner === null || owner === id) return;
  const active = document.activeElement;
  if (active !== null && active !== document.body && !root.contains(active))
    return;
  if (focusOwner(root) !== id) focusPane(root, id);
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
  if (!target.classList.contains('pierre-layouts-corner')) return touching;
  const bounds = target.getBoundingClientRect();
  for (const corner of root.querySelectorAll<HTMLElement>(
    ':scope > [data-layouts-corner]'
  )) {
    const other = corner.getBoundingClientRect();
    if (Math.abs(bounds.x - other.x) < 1 && Math.abs(bounds.y - other.y) < 1) {
      const spec = corners.find(
        ({ id }) => id === corner.dataset.layoutsCorner
      );
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
