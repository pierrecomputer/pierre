'use client';

// `stacks()`: panes in stacks with tabs. The store part has `activate`,
// `addTab`, `moveToStack`, and `moveTab`. The view part makes each pane host
// the tab panel of its tab in `Layout.TabList`, and gives `Layout.Tab` the
// commands that show or move a tab and keep the focus on it.
import { useEffect, useState } from 'react';

import { focusTab, paneHosts } from '../../dom/panes';
import { type StackCommands, stacks as stacksStore } from '../../stacks';
import { cell } from '../cell';
import {
  type Feature,
  type FeatureHooks,
  tabIdOf,
  type ViewContext,
} from '../contract';

let warnedTabList = false;

function useStacks(context: ViewContext): FeatureHooks {
  // The tab to focus after the next change, when its host shows.
  const [pending] = useState(() => cell<string | null>(null));
  const store = context.store as unknown as StackCommands;
  if (process.env.NODE_ENV !== 'production')
    // The condition is the same for each render of a build.
    // oxlint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      const element = context.element();
      if (element === null || warnedTabList) return;
      for (const host of paneHosts(element)) {
        const tab = host.getAttribute('aria-labelledby');
        if (tab !== null && document.getElementById(tab) === null) {
          warnedTabList = true;
          console.warn(
            '@pierre/layouts: stacks() names each pane by its tab. Render Layout.TabList in the header of each pane.'
          );
          return;
        }
      }
    });
  return {
    // Each host is the tab panel of the tab of its pane, in its own tab list.
    host: ({ pane }) => ({
      attributes: {
        role: 'tabpanel',
        'aria-label': undefined,
        'aria-labelledby': tabIdOf(context.prefix, pane.id, pane.id),
      },
    }),
    selectTab(id) {
      const before = context.store.getSnapshot();
      pending.set(id);
      store.activate(id);
      if (context.store.getSnapshot() === before) pending.set(null);
    },
    moveTab(id, index) {
      const before = context.store.getSnapshot();
      pending.set(id);
      store.moveTab(id, index);
      if (context.store.getSnapshot() === before) pending.set(null);
    },
    focusTab(id) {
      pending.set(id);
    },
    afterChange(_previous, _next, element) {
      const tab = pending.get();
      if (tab === null) return;
      focusTab(element, tab);
      pending.set(null);
    },
  };
}

/**
 * Stacks of panes with tabs: `layout.activate`, `addTab`, `moveToStack`, and
 * `moveTab`, with `Layout.TabList` and `Layout.Tab`. Each pane host is the
 * tab panel of its tab, so render a `Layout.TabList` in the header of each
 * pane; a pane outside a stack shows its own tab.
 */
export function stacks(): Feature<StackCommands> {
  return {
    name: 'stacks',
    requires: ['edits'],
    store: stacksStore,
    use: useStacks,
  };
}
