'use client';

// The tab parts: `Layout.TabList` renders the tabs of the stack of its pane,
// or the tab of a pane outside a stack, and `Layout.Tab` is one tab, with the
// keys of the APG tabs pattern.
import {
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';

import stickyPinnedCss from '../../css/sticky-pinned.css?inline';
import tabsCss from '../../css/tabs.css?inline';
import { tabMoveIndex } from '../../stacks-model';
import { treeIndex } from '../../tree-index';
import type { PaneNode } from '../../types';
import {
  paneIdOf,
  type PaneMessageValues,
  Style,
  TabContext,
  type TabContextValue,
  tabIdOf,
  type ViewContext,
} from '../contract';
import { useDrag } from '../drag';
import { usePaneContext, usePaneState } from '../use-pane';
import { canClose, closePane } from './close';
import { nameHost } from './host-name';
import {
  mergeProps,
  type PartProps,
  renderPart,
  useLayoutState,
  warnMissing,
} from './part';

/**
 * The elements inside a tab that keep a press for themselves: a field, a
 * button, a link, editable text, or a close mark (`data-layouts-tab-close`).
 */
const TAB_CONTROLS =
  'input,textarea,select,button,a[href],[contenteditable]:not([contenteditable="false"]),[data-layouts-tab-close]';

const tabsName = ({ paneTitle }: PaneMessageValues): string =>
  `Tabs of ${paneTitle}`;

/** The state of a tab, for the children of `Layout.TabList`. */
export interface TabListItemState {
  /** The tab shows in its stack. */
  active: boolean;
  /** The place of the tab among the tabs that show. */
  index: number;
}

export interface TabListProps extends Omit<PartProps<object>, 'children'> {
  /** The content of each tab, `<Layout.Tab />` by default. */
  children?: (tab: PaneNode, state: TabListItemState) => ReactNode;
  /**
   * `'automatic'` (the default): the arrows, Home, and End select the tab
   * that they focus. `'manual'`: they move the focus only, and Enter or Space
   * selects the focused tab, as the APG tabs pattern advises when a panel
   * does not show at once, or when its content takes the focus.
   */
  activation?: 'automatic' | 'manual';
  /**
   * Keep the pinned tabs in view while the other tabs scroll: each pinned tab
   * sticks at its own place, with an inline `position: sticky` and `left`,
   * and the list holds the width of the pinned tabs in
   * `--layouts-pinned-width`, for the app's fade or scroll padding. It turns
   * itself off while less than `minRoom` px of the list (120 by default) is
   * left for the other tabs. The tab list needs to be the element that
   * scrolls. Only a tab list with this option adds its sheet,
   * `pierre-layouts-sticky-pinned`.
   */
  stickyPinned?: boolean | StickyPinnedOptions;
}

/** The options of `stickyPinned` on `Layout.TabList`. */
export interface StickyPinnedOptions {
  /**
   * The least width in pixels that the sticky pinned tabs leave for the other
   * tabs. In a narrower list, the pinned tabs scroll with the others. 120 by
   * default; 0 keeps them in view at every width.
   */
  readonly minRoom?: number;
}

// The default `minRoom` of `stickyPinned`.
const STICKY_ROOM = 120;

/**
 * Make the pinned tabs of a tab list sticky, at the places that they have
 * when they do not stick, as each render and each resize of the list
 * measures them. A stuck tab reports its stuck place, so the measure runs
 * without the sticky styles. The position is inline, as the styles of the
 * gestures are, so that an app's class on a tab, such as a `relative`
 * utility in a later layer, cannot undo it.
 */
function useStickyPinned(
  tablist: RefObject<HTMLElement | null>,
  options: boolean | StickyPinnedOptions
): void {
  useLayoutEffect(() => {
    const list = tablist.current;
    if (options === false || list === null) return;
    // `true` has no `minRoom`, so it takes the default.
    const minRoom = (options as StickyPinnedOptions).minRoom ?? STICKY_ROOM;
    const pinned = (): HTMLElement[] => [
      ...list.querySelectorAll<HTMLElement>(':scope > [data-pinned]'),
    ];
    const stick = (sticky: boolean, width = 0): void => {
      list.toggleAttribute('data-sticky-pinned', sticky);
      list.style.setProperty('--layouts-pinned-width', `${width}px`);
      for (const item of pinned()) {
        item.style.left = sticky ? `${item.offsetLeft}px` : '';
        item.style.position = sticky ? 'sticky' : '';
        item.toggleAttribute('data-sticky', sticky);
      }
    };
    const place = (): void => {
      stick(false);
      const tabs = pinned();
      const last = tabs.at(-1);
      const width =
        last === undefined
          ? 0
          : last.offsetLeft + last.offsetWidth - tabs[0].offsetLeft;
      if (width > 0 && list.clientWidth - width >= minRoom) stick(true, width);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(list);
    return () => {
      observer.disconnect();
      stick(false);
    };
  });
}

const defaultTab = (): ReactNode => <Tab />;

/**
 * Make the host of a pane the tab panel of the tab of its pane, named by that
 * tab, while a tab list shows in the host. A host without a tab list stays a
 * region named by the title of its pane. The tab list says that it renders
 * in the host (`nameHost`), which writes the role and the name of the host.
 */
function useTabPanel(
  context: ViewContext,
  id: string
): RefObject<HTMLElement | null> {
  const tablist = useRef<HTMLElement | null>(null);
  useLayoutEffect(
    () =>
      tablist.current === null
        ? undefined
        : nameHost(tablist.current, 'tab', tabIdOf(context.prefix, id, id)),
    [context, id]
  );
  return tablist;
}

/**
 * The tabs of the stack of the pane, in a `tablist`: the tabs that show, in
 * their order. A pane outside a stack shows its own tab. It needs
 * `stacks()`.
 *
 * Each host of a stack renders its pane's chrome, also the hosts of the tabs
 * that do not show. There, the list holds only the tab of its own pane, which
 * names the tab panel of the host. So a stack of n tabs renders 2n - 1 tabs,
 * and a change of tab renders two tab lists: the one that hides and the one
 * that shows.
 */
export function TabList({
  render,
  children = defaultTab,
  activation,
  stickyPinned = false,
  ...props
}: TabListProps): JSX.Element {
  const value = usePaneContext('Layout.TabList');
  const { context } = value;
  warnMissing(context.has('stacks'), 'Layout.TabList', 'stacks()');
  const tablist = useTabPanel(context, value.id);
  const pane = usePaneState(value, (state) => state.pane);
  const title = usePaneState(value, (state) => state.title);
  const tabs = usePaneState(value, (state) => state.tabs);
  // The pane of the host is the tab that shows in its stack. Only this value
  // changes for a change of tab, so only two tab lists render for it.
  const own = usePaneState(value, (state) => state.activeTab === state.id);
  const shown = tabs.filter((tab) =>
    own ? tab.hidden !== true : tab.id === value.id
  );
  useStickyPinned(tablist, own && stickyPinned);
  return (
    <>
      <Style name="tabs" css={tabsCss} settings={context.stylesheets()} />
      {stickyPinned !== false && (
        <Style
          name="sticky-pinned"
          css={stickyPinnedCss}
          settings={context.stylesheets()}
        />
      )}
      {renderPart(
        'div',
        render,
        mergeProps(props, {
          ref: tablist,
          role: 'tablist',
          'aria-label': (context.messages().tabs ?? tabsName)({
            paneTitle: title,
            paneId: pane.id,
          }),
          className: 'pierre-layouts-tabs',
          'data-layouts-tablist': '',
          children: shown.map((tab, index) => (
            <TabContext
              key={tab.id}
              value={{ tab, tabs: shown, manual: activation === 'manual' }}
            >
              {children(tab, { active: own && tab.id === value.id, index })}
            </TabContext>
          )),
        }),
        {}
      )}
    </>
  );
}

export interface TabState {
  /** The tab shows in its stack. */
  active: boolean;
  /** The tab moves in a drag. */
  dragging: boolean;
}

/**
 * One tab of `Layout.TabList`: `role=tab`, the selection, the link to the
 * host of its pane, a roving tab stop, and the start of a drag with
 * `tabDrag()`. The arrows, Home, and End move the
 * focus to another tab, which shows; with `activation="manual"` on the tab
 * list, Enter or Space shows it. Delete closes the tab. Ctrl+Shift with
 * PageUp or PageDown moves the tab before the previous tab or after the next,
 * inside the pinned run or after it. A pinned tab has `data-pinned` and the
 * description "Pinned".
 * An app's handler that calls `preventDefault()` stops the tab's own handler
 * for that event: a prevented key does nothing, a prevented click selects
 * nothing, and a prevented `pointerdown` starts no drag.
 */
export function Tab({
  render,
  children,
  ...props
}: PartProps<TabState>): JSX.Element {
  const value = usePaneContext('Layout.Tab');
  const tabValue = useContext(TabContext);
  if (tabValue === null)
    throw new Error('Layout.Tab must be in Layout.TabList');
  const { id: host, context } = value;
  const { tab, tabs, manual }: TabContextValue = tabValue;
  // The tab of another pane of the stack: its title follows `getPaneTitle`,
  // and the tab renders only when its own title changes.
  const titleOf = (): string => context.title(tab);
  const title = useSyncExternalStore(context.onTitles, titleOf, titleOf);
  const active = usePaneState(value, (state) => state.activeTab === tab.id);
  const dragging = useDrag(
    context,
    (drag) => drag?.source.kind === 'tab' && drag.source.id === tab.id
  );
  const closable = useLayoutState(context.store, (state) =>
    canClose(context, state, tab.id)
  );
  // Each hook reads the hooks of the last render of `Root`, in an event.
  const hook = <Key extends 'selectTab' | 'moveTab'>(key: Key) =>
    context.hooks().find((hooks) => hooks[key] !== undefined)?.[key];
  const select = (id: string): void => hook('selectTab')?.(id);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    // Only the keys of the tab element itself: a field or a button inside the
    // tab keeps its own arrows and Delete.
    if (event.target !== event.currentTarget) return;
    const at = tabs.indexOf(tab);
    if (
      event.ctrlKey &&
      event.shiftKey &&
      (event.key === 'PageUp' || event.key === 'PageDown')
    ) {
      // The browser does not move its own tab for a key that the page uses.
      event.preventDefault();
      const boundary = event.key === 'PageUp' ? at - 1 : at + 2;
      const order = stackOrder(context, tab.id);
      const index =
        boundary < 0 || boundary > tabs.length
          ? null
          : tabMoveIndex(
              order,
              tabs.map((other) => other.id),
              tab.id,
              boundary
            );
      if (index !== null) hook('moveTab')?.(tab.id, index);
      return;
    }
    const next =
      event.key === 'ArrowRight'
        ? tabs[(at + 1) % tabs.length]
        : event.key === 'ArrowLeft'
          ? tabs[(at - 1 + tabs.length) % tabs.length]
          : event.key === 'Home'
            ? tabs[0]
            : event.key === 'End'
              ? tabs[tabs.length - 1]
              : null;
    if (next !== null) {
      event.preventDefault();
      if (!manual) {
        if (next.id !== tab.id) select(next.id);
      } else
        document
          .getElementById(tabIdOf(context.prefix, host, next.id))
          ?.focus();
    } else if (manual && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      if (!active) select(tab.id);
    } else if (event.key === 'Delete' && closable) {
      event.preventDefault();
      closePane(context, tab.id);
    }
  };
  return renderPart(
    'button',
    render,
    mergeProps(props, {
      type: 'button',
      id: tabIdOf(context.prefix, host, tab.id),
      role: 'tab',
      className: 'pierre-layouts-tab',
      'aria-selected': active,
      'aria-controls': paneIdOf(context.prefix, tab.id),
      tabIndex: active ? 0 : -1,
      'data-layouts-tab': tab.id,
      'data-pinned': tab.pinned,
      'aria-description': tab.pinned && (context.messages().pinned ?? 'Pinned'),
      'data-active': active || undefined,
      'data-dragging': dragging || undefined,
      onClick: () => {
        if (!active) select(tab.id);
      },
      // A press on a control inside the tab, such as a field or a close
      // mark, is the control's own and starts no drag. The tab element is a
      // button by default, so it does not count as a control of itself.
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        const control = (event.target as Element).closest(TAB_CONTROLS);
        if (
          control !== null &&
          control !== event.currentTarget &&
          event.currentTarget.contains(control)
        )
          return;
        context
          .hooks()
          .find((hooks) => hooks.startTabDrag !== undefined)
          ?.startTabDrag?.(tab, tabs, event);
      },
      onKeyDown,
      children: children ?? (
        <span className="pierre-layouts-tab-title">{title}</span>
      ),
    }),
    { active, dragging }
  );
}

/** The IDs of the tabs of the stack of a pane, hidden ones included, in order. */
function stackOrder(context: ViewContext, id: string): string[] {
  const stack = treeIndex(context.store.getSnapshot().root).panes.get(
    id
  )?.stack;
  return stack?.children.map((tab) => tab.id) ?? [id];
}
