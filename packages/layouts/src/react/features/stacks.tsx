'use client';

// `stacks()`: panes in stacks with tabs. The store part has `activate`,
// `addTab`, `moveToStack`, and `moveTab`. The view part gives `Layout.Tab`
// the commands that show or move a tab and keep the focus on it.
// `Layout.TabList` makes the host of its pane the tab panel of its tab.
import { useEffect, useState } from 'react';

import { focusTab, paneHosts } from '../../dom/panes';
import { type StackCommands, stacksStore } from '../../stacks';
import { treeIndex } from '../../tree-index';
import { cell } from '../cell';
import type {
  Feature,
  FeatureHooks,
  FeatureModule,
  TargetMessageValues,
  ViewContext,
} from '../contract';

let warnedTabList = false;

const movedToTabsText = ({
  paneTitle,
  targetTitle,
}: TargetMessageValues): string =>
  `${paneTitle} moved into the group of ${targetTitle}`;
const mergedText = ({
  paneTitles,
  targetTitle,
}: {
  paneTitles: string;
  targetTitle: string;
}): string => `${paneTitles} moved into the group of ${targetTitle}`;

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
      const { panes } = treeIndex(context.store.getSnapshot().root);
      for (const host of paneHosts(element)) {
        const id = host.getAttribute('data-layouts-pane') ?? '';
        if (
          panes.get(id)?.stack != null &&
          host.getAttribute('role') !== 'tabpanel'
        ) {
          warnedTabList = true;
          console.warn(
            '@pierre/layouts: a pane of a stack shows its tabs. Render Layout.TabList in the header of each pane of a stack.'
          );
          return;
        }
      }
    });
  return {
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
 * `moveTab`, with `Layout.TabList` and `Layout.Tab`. Render a
 * `Layout.TabList` in the header of each pane of a stack; a pane outside a
 * stack can show its own tab with one too, or a `Layout.Title`.
 */
export function stacks(): Feature<StackCommands> {
  const feature: FeatureModule<StackCommands> = {
    name: 'stacks',
    requires: ['edits'],
    store: stacksStore,
    // A move into another stack. The tab list shows a move inside one stack.
    announce(operation, { previous, operations, pane, target, messages }) {
      if (operation.type !== 'moveToStack') return null;
      // A merge: the moves of one change into one stack speak once, at the last.
      const moves = operations.filter(
        (each) =>
          each.type === 'moveToStack' && each.target === operation.target
      );
      if (moves.length > 1)
        return operation === moves.at(-1)
          ? (messages.merged ?? mergedText)({
              paneTitles: moves
                .map((each) => pane((each as typeof operation).pane).paneTitle)
                .join(', '),
              count: moves.length,
              ...target(operation.target),
            })
          : null;
      const { panes } = treeIndex(previous.root);
      const stack = panes.get(operation.pane)?.stack;
      return stack != null && stack === panes.get(operation.target)?.stack
        ? null
        : (messages.movedToTabs ?? movedToTabsText)({
            ...pane(operation.pane),
            ...target(operation.target),
          });
    },
    use: useStacks,
  };
  return feature;
}
