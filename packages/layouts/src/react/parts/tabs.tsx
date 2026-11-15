'use client';

// The tab parts: `Layout.TabList` renders the tabs of the stack of its pane,
// or the tab of a pane outside a stack, and `Layout.Tab` is one tab, with the
// keys of the APG tabs pattern.
import {
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  useContext,
} from 'react';

import tabsCss from '../../css/tabs.css?inline';
import { tabMoveIndex } from '../../stacks-model';
import { treeIndex } from '../../tree-index';
import type { PaneNode } from '../../types';
import {
  paneIdOf,
  Style,
  TabContext,
  type TabContextValue,
  tabIdOf,
  type ViewContext,
} from '../contract';
import { useDrag } from '../drag';
import { usePaneContext, usePaneState } from '../use-pane';
import { canClose, closePane } from './close';
import {
  mergeProps,
  type PartProps,
  renderPart,
  useLayoutState,
  warnMissing,
} from './part';

const tabsName = (title: string): string => `Tabs of ${title}`;

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
}

const defaultTab = (): ReactNode => <Tab />;

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
  ...props
}: TabListProps): JSX.Element {
  const value = usePaneContext('Layout.TabList');
  const { context } = value;
  warnMissing(context.has('stacks'), 'Layout.TabList', 'stacks()');
  const pane = usePaneState(value, (state) => state.pane);
  const tabs = usePaneState(value, (state) => state.tabs);
  // The pane of the host is the tab that shows in its stack. Only this value
  // changes for a change of tab, so only two tab lists render for it.
  const own = usePaneState(value, (state) => state.activeTab === state.id);
  const shown = tabs.filter((tab) =>
    own ? tab.hidden !== true : tab.id === value.id
  );
  return (
    <>
      <Style name="tabs" css={tabsCss} settings={context.stylesheets()} />
      {renderPart(
        'div',
        render,
        mergeProps(props, {
          role: 'tablist',
          'aria-label': (context.messages().tabs ?? tabsName)(
            context.title(pane)
          ),
          className: 'pierre-layout-tabs',
          'data-layout-tablist': '',
          children: shown.map((tab, index) => (
            <TabContext key={tab.id} value={{ tab, tabs: shown }}>
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
 * host of its pane, and a roving tab stop. The arrows, Home, and End move the
 * focus to another tab, which shows. Delete closes the tab. Ctrl+Shift with
 * PageUp or PageDown moves the tab before the previous tab or after the next.
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
  const { tab, tabs }: TabContextValue = tabValue;
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
      if (next.id !== tab.id) select(next.id);
    } else if (event.key === 'Delete' && closable) {
      event.preventDefault();
      closePane(context, tab.id);
    }
  };
  const extra: Record<string, unknown> = {};
  for (const hooks of context.hooks())
    Object.assign(extra, hooks.tabProps?.(tab, tabs));
  return renderPart(
    'button',
    render,
    mergeProps(mergeProps(props, extra), {
      type: 'button',
      id: tabIdOf(context.prefix, host, tab.id),
      role: 'tab',
      className: 'pierre-layout-tab',
      'aria-selected': active,
      'aria-controls': paneIdOf(context.prefix, tab.id),
      tabIndex: active ? 0 : -1,
      'data-layout-tab': tab.id,
      'data-active': active || undefined,
      'data-dragging': dragging || undefined,
      onClick: () => {
        if (!active) select(tab.id);
      },
      onKeyDown,
      children: children ?? context.title(tab),
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
