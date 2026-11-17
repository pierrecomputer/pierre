/**
 * The scroll of a tab list toward one of its ends, for
 * `Layout.TabListScrollButton`: the next tab that does not show on that side.
 * A tab shows when it lies inside the list's box after the stuck pinned tabs,
 * or, when it is wider than that part, when its start lies inside it. The
 * buttons of a pane follow the current tab list of its host, with one
 * measurement for all the buttons of a list.
 */
import { onPaneTablist, paneTablist } from './pane-tablist';
import { tabsOf } from './tab-drag';

/**
 * The next tab on `side` of a tab list that does not show, which a scroll
 * toward that side shows, or null when every tab on that side shows or the
 * list cannot scroll that way. A tab with `data-sticky` is stuck, so it
 * shows.
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

/** What the scroll buttons of a pane read from its tab list. */
export interface TabScroll {
  /** A press of the start button shows a tab. */
  readonly start: boolean;
  /** A press of the end button shows a tab. */
  readonly end: boolean;
  /** The width of the stuck pinned tabs, after which a start button can sit. */
  readonly pinned: number;
}

const NO_SCROLL: TabScroll = { start: false, end: false, pinned: 0 };

function measure(list: HTMLElement): TabScroll {
  if (!list.isConnected) return NO_SCROLL;
  const pinned = Number.parseFloat(
    list.style.getPropertyValue('--layouts-pinned-width')
  );
  return {
    start: tabToShow(list, 'start') !== null,
    end: tabToShow(list, 'end') !== null,
    pinned: Number.isNaN(pinned) ? 0 : pinned,
  };
}

interface ListWatch {
  scroll: TabScroll;
  readonly listeners: Set<(scroll: TabScroll) => void>;
  stop(): void;
}

// The watch of each tab list, which all the buttons of the list share.
const watches = new WeakMap<HTMLElement, ListWatch>();

/**
 * Watch a tab list: its size, its tabs and their sizes, their stuck state,
 * the width of the stuck tabs, and its scroll. The listeners of a list share
 * one watch, and get the reading when it changes.
 */
function watchList(
  list: HTMLElement,
  listener: (scroll: TabScroll) => void
): () => void {
  let watch = watches.get(list);
  if (watch === undefined) {
    const listeners = new Set<(scroll: TabScroll) => void>();
    let frame = 0;
    const read = (): void => {
      const next = measure(list);
      const { scroll } = watch as ListWatch;
      if (
        next.start === scroll.start &&
        next.end === scroll.end &&
        next.pinned === scroll.pinned
      )
        return;
      (watch as ListWatch).scroll = next;
      for (const each of [...listeners]) each(next);
    };
    const onScroll = (): void => {
      if (frame === 0)
        frame = requestAnimationFrame(() => {
          frame = 0;
          read();
        });
    };
    const sizes = new ResizeObserver(read);
    const observe = (): void => {
      sizes.disconnect();
      sizes.observe(list);
      for (const child of list.children) sizes.observe(child);
    };
    const changes = new MutationObserver((records) => {
      if (records.some(({ type }) => type === 'childList')) observe();
      // The style of the list holds the width of the stuck tabs. The style of
      // a tab changes with the sticky places, which `data-sticky` reports.
      if (
        records.some(
          ({ attributeName, target }) =>
            attributeName !== 'style' || target === list
        )
      )
        read();
    });
    observe();
    changes.observe(list, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-sticky', 'data-sticky-pinned', 'style'],
    });
    list.addEventListener('scroll', onScroll, { passive: true });
    watch = {
      scroll: measure(list),
      listeners,
      stop() {
        sizes.disconnect();
        changes.disconnect();
        list.removeEventListener('scroll', onScroll);
        cancelAnimationFrame(frame);
        watches.delete(list);
      },
    };
    watches.set(list, watch);
  }
  const shared = watch;
  shared.listeners.add(listener);
  listener(shared.scroll);
  return () => {
    shared.listeners.delete(listener);
    if (shared.listeners.size === 0) shared.stop();
  };
}

/**
 * Watch the scroll of the tab list of a pane host, and of each list that
 * replaces it: the listener gets the reading at once, and after each change.
 */
export function watchTabScroll(
  host: Element,
  listener: (scroll: TabScroll) => void
): () => void {
  let unwatch = (): void => {};
  const follow = (): void => {
    unwatch();
    const list = paneTablist(host);
    if (list === null) {
      unwatch = () => {};
      listener(NO_SCROLL);
    } else unwatch = watchList(list, listener);
  };
  const stop = onPaneTablist(host, follow);
  follow();
  return () => {
    stop();
    unwatch();
  };
}
