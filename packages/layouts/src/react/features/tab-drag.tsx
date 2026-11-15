'use client';

// `tabDrag()`: drag a tab with the drag engine of the view: within its tab
// list to change the order of the tabs, into another tab list or the center
// of another pane to join its stack, or to an edge of a pane to leave the
// stack. While a pane fills the layout, only the tab list of the tab's own
// stack takes a drop.
import dropCss from '../../css/drop.css?inline';
import tabDragCss from '../../css/tab-drag.css?inline';
import type { EditCommands } from '../../edits';
import { presentation } from '../../presentation';
import type { StackCommands } from '../../stacks';
import { tabInsertIndex, tabMoveIndex } from '../../stacks-model';
import { treeIndex } from '../../tree-index';
import type { Edge, LayoutState } from '../../types';
import type {
  Feature,
  FeatureHooks,
  ViewContext,
  ViewRender,
} from '../contract';
import {
  type Drag,
  DropPreview,
  type DropTarget,
  startDrag,
  useDrag,
} from '../drag';

const TAB = 'tab';

const moveText = (title: string, edge: Edge, target: string): string =>
  `Move ${title} to the ${edge} of ${target}`;

const moveIntoText = (title: string, target: string): string =>
  `Move ${title} into the group of ${target}`;

function titleOf(context: ViewContext, state: LayoutState, id: string): string {
  const pane = treeIndex(state.root).panes.get(id)?.pane;
  return pane === undefined ? id : context.title(pane);
}

/** Apply the drop of a tab, and focus the tab after the change. */
function dropTab(context: ViewContext, id: string, target: DropTarget): void {
  const store = context.store as unknown as Partial<
    StackCommands & EditCommands
  >;
  const hooks = context.hooks();
  const focusTab = hooks.find((hook) => hook.focusTab !== undefined)?.focusTab;
  const { panes } = treeIndex(context.store.getSnapshot().root);
  const stack = panes.get(id)?.stack ?? null;
  const targetStack = panes.get(target.paneId)?.stack ?? null;
  if (target.boundary !== undefined && target.tabs !== undefined) {
    if (stack !== null && stack === targetStack) {
      const index = tabMoveIndex(
        stack.children.map((tab) => tab.id),
        target.tabs,
        id,
        target.boundary
      );
      if (index !== null)
        hooks.find((hook) => hook.moveTab !== undefined)?.moveTab?.(id, index);
      return;
    }
    focusTab?.(id);
    store.moveToStack?.(
      id,
      target.paneId,
      tabInsertIndex(
        targetStack?.children.map((tab) => tab.id) ?? [target.paneId],
        target.tabs,
        target.boundary
      )
    );
    return;
  }
  focusTab?.(id);
  if (target.place === 'center') store.moveToStack?.(id, target.paneId);
  else store.move?.(id, target.paneId, target.place);
}

function useTabDrag(context: ViewContext, { state }: ViewRender): FeatureHooks {
  const drag = useDrag(context, (value: Drag | null) =>
    value?.source.kind === TAB ? value : null
  );
  // A move inside the tab list of the tab's own stack announces nothing, as
  // the tab list shows the place.
  const { panes } = treeIndex(state.root);
  const stack =
    drag === null ? null : (panes.get(drag.source.id)?.stack ?? null);
  const own =
    drag?.target?.boundary !== undefined &&
    stack !== null &&
    panes.get(drag.target.paneId)?.stack === stack;
  const target = own ? null : (drag?.target ?? null);
  const messages = context.messages();
  return {
    startTabDrag(tab, _tabs, event) {
      const current = context.store.getSnapshot();
      const stack = treeIndex(current.root).panes.get(tab.id)?.stack;
      startDrag(context, event, {
        source: { kind: TAB, id: tab.id },
        center: true,
        group: stack?.children
          .filter((other) => other.hidden !== true)
          .map((other) => other.id) ?? [tab.id],
        rearrange: presentation(current).rearrangeable,
        drop: (to) => dropTab(context, tab.id, to),
      });
    },
    host:
      drag === null
        ? undefined
        : ({ pane }) =>
            pane.id === drag.source.id
              ? { attributes: { 'data-moving': true } }
              : undefined,
    layers: () => <DropPreview context={context} kind={TAB} />,
    status:
      drag === null || target === null
        ? null
        : target.place === 'center'
          ? (messages.moveInto ?? moveIntoText)(
              titleOf(context, state, drag.source.id),
              titleOf(context, state, target.paneId)
            )
          : (messages.move ?? moveText)(
              titleOf(context, state, drag.source.id),
              target.place,
              titleOf(context, state, target.paneId)
            ),
  };
}

/**
 * Drag a tab: within its tab list to change the order, into another stack,
 * or to an edge of a pane. It requires `stacks()`.
 */
export function tabDrag(): Feature {
  return {
    name: 'tab-drag',
    requires: ['stacks'],
    use: useTabDrag,
    stylesheets: [
      ['drop', dropCss],
      ['tab-drag', tabDragCss],
    ],
  };
}
