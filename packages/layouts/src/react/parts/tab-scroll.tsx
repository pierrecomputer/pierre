'use client';

// `Layout.TabListScrollButton`: a button that scrolls the tab list of its pane
// toward one end, to the next tab that does not show there.
import { type JSX, type MouseEvent, useLayoutEffect, useState } from 'react';

import { tablistOf, tabToShow } from '../../dom/tab-scroll';
import { usePaneContext } from '../use-pane';
import { mergeProps, type PartProps, renderPart } from './part';

export interface TabListScrollButtonState {
  /** A tab that does not show lies on the side of the button: a press shows it. */
  canScroll: boolean;
}

export interface TabListScrollButtonProps extends PartProps<TabListScrollButtonState> {
  /** The end of the tab list that the button scrolls toward. */
  side: 'start' | 'end';
}

const scrollName = ({ side }: { side: 'start' | 'end' }): string =>
  side === 'start' ? 'Scroll tabs left' : 'Scroll tabs right';

// What the button reads from its tab list: whether a press scrolls, and the
// width of the stuck pinned tabs, after which the start button can sit.
interface Reading {
  canScroll: boolean;
  pinned: number;
}

/**
 * Watch the tab list of the pane of a button: its size, its tabs, their
 * stuck state, and its scroll. It calls `read` for each change.
 */
function watchTablist(element: HTMLElement, read: () => void): () => void {
  const list = tablistOf(element);
  if (list === null) return () => {};
  let frame = 0;
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
  const changes = new MutationObserver(() => {
    observe();
    read();
  });
  observe();
  changes.observe(list, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-sticky', 'data-sticky-pinned'],
  });
  list.addEventListener('scroll', onScroll, { passive: true });
  read();
  return () => {
    sizes.disconnect();
    changes.disconnect();
    list.removeEventListener('scroll', onScroll);
    cancelAnimationFrame(frame);
  };
}

/**
 * Scroll the tab list of the pane toward `side`, to the next tab that does
 * not show there: a tab that is not stuck and lies outside the list's box
 * after the stuck pinned tabs (a tab wider than that part shows when its
 * start does). The tab scrolls into view inside the list's scroll padding,
 * where the app keeps its buttons and fades clear. With no
 * such tab, the button is disabled and hidden, and keeps its room, so nothing
 * moves when it shows. Put it beside the tab list, in the header of the pane,
 * or over the list's ends with the app's fades; its
 * `--layouts-pinned-width` gives the width of the stuck pinned tabs, after
 * which a start button can sit. A press takes no focus: the tab list's keys
 * move through the tabs.
 */
export function TabListScrollButton({
  side,
  render,
  children,
  ...props
}: TabListScrollButtonProps): JSX.Element {
  const { context } = usePaneContext('Layout.TabListScrollButton');
  const [button, setButton] = useState<HTMLElement | null>(null);
  const [reading, setReading] = useState<Reading>({
    canScroll: false,
    pinned: 0,
  });
  useLayoutEffect(() => {
    if (button === null) return;
    return watchTablist(button, () => {
      const list = tablistOf(button);
      const pinned = Number.parseFloat(
        list?.style.getPropertyValue('--layouts-pinned-width') ?? ''
      );
      const next = {
        canScroll: list !== null && tabToShow(list, side) !== null,
        pinned: Number.isNaN(pinned) ? 0 : pinned,
      };
      setReading((current) =>
        current.canScroll === next.canScroll && current.pinned === next.pinned
          ? current
          : next
      );
    });
  }, [button, side]);
  const { canScroll } = reading;
  return renderPart(
    'button',
    render,
    mergeProps(props, {
      ref: setButton,
      type: 'button',
      tabIndex: -1,
      className: 'pierre-layouts-tab-scroll',
      'aria-label': (context.messages().scrollTabs ?? scrollName)({ side }),
      disabled: !canScroll,
      'data-disabled': !canScroll || undefined,
      'data-side': side,
      style: {
        '--layouts-pinned-width': `${reading.pinned}px`,
        visibility: canScroll ? undefined : 'hidden',
      },
      onMouseDown: (event: MouseEvent) => event.preventDefault(),
      onClick: (event: MouseEvent<HTMLElement>) => {
        const list = tablistOf(event.currentTarget);
        const tab = list === null ? null : tabToShow(list, side);
        if (list === null || tab === null) return;
        const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
        // The list's scroll padding keeps the tab clear of the stuck pinned
        // tabs and of the app's buttons and fades. A tab toward the end
        // aligns its end, unless it is wider than the list.
        tab.scrollIntoView({
          inline:
            side === 'end' && tab.offsetWidth < list.clientWidth
              ? 'end'
              : 'start',
          block: 'nearest',
          behavior: still ? 'auto' : 'smooth',
        });
      },
      children: children ?? (side === 'start' ? '‹' : '›'),
    }),
    { canScroll }
  );
}
