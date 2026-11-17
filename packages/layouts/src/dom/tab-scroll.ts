/**
 * The scroll of a tab list toward one of its ends, for
 * `Layout.TabListScrollButton`: the next tab that does not show on that side.
 * A tab shows when it lies inside the list's box after the stuck pinned tabs,
 * or, when it is wider than that part, when its start lies inside it.
 */
import { TABLIST_ATTRIBUTE, tabsOf } from './tab-drag';

/** The tab list of the pane host of an element, or null. */
export function tablistOf(element: Element | null): HTMLElement | null {
  return (
    element
      ?.closest('[data-layouts-pane]')
      ?.querySelector<HTMLElement>(`[${TABLIST_ATTRIBUTE}]`) ?? null
  );
}

/**
 * The next tab on `side` of a tab list that does not show, which a scroll
 * toward that side shows, or null when every tab on that side shows or the
 * list cannot scroll that way.
 */
export function tabToShow(
  list: HTMLElement,
  side: 'start' | 'end'
): HTMLElement | null {
  const scrolled = list.scrollLeft;
  const max = list.scrollWidth - list.clientWidth;
  if (side === 'end' ? scrolled >= max - 1 : scrolled <= 1) return null;
  const box = list.getBoundingClientRect();
  const tabs = tabsOf(list);
  const start = Math.max(
    box.left,
    ...tabs
      .filter((tab) => tab.hasAttribute('data-sticky'))
      .map((tab) => tab.getBoundingClientRect().right)
  );
  const loose = tabs.filter((tab) => !tab.hasAttribute('data-sticky'));
  if (side === 'start')
    return (
      loose.findLast((tab) => tab.getBoundingClientRect().left < start - 1) ??
      null
    );
  return (
    loose.find((tab) => {
      const rect = tab.getBoundingClientRect();
      // A tab wider than the part after the stuck tabs shows when its
      // start does.
      return rect.width > box.right - start
        ? rect.left > box.right
        : rect.right > box.right + 1;
    }) ?? null
  );
}
