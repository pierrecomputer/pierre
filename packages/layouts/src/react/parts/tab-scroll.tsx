'use client';

// `Layout.TabListScrollButton`: a button that scrolls the tab list of its pane
// toward one end, to the next tab that does not show there.
import { type JSX, type MouseEvent, useLayoutEffect, useState } from 'react';

import { paneTablist } from '../../dom/pane-tablist';
import { tabToShow, watchTabScroll } from '../../dom/tab-scroll';
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

// What a button reads from its tab list: whether a press scrolls, and the
// width of the stuck pinned tabs, after which the start button can sit.
interface Reading {
  canScroll: boolean;
  pinned: number;
}

const hostOf = (element: Element): Element | null =>
  element.closest('[data-layouts-pane]');

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
 * move through the tabs. The button follows the tab list that shows in its
 * pane, also a list that replaces another one, and the buttons of a list
 * share one measurement.
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
    const host = button === null ? null : hostOf(button);
    if (host === null) return;
    return watchTabScroll(host, (scroll) => {
      const next = {
        canScroll: side === 'start' ? scroll.start : scroll.end,
        pinned: scroll.pinned,
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
        const host = hostOf(event.currentTarget);
        const list = host === null ? null : paneTablist(host);
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
