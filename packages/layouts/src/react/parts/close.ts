// Close a pane or a tab: the app's `onPaneClose`, or `layout.close` from
// `edits()`.
import { focusPane, focusTab } from '../../dom/panes';
import { treeIndex } from '../../tree-index';
import type { LayoutState } from '../../types';
import type { ViewContext } from '../contract';

type Closing = { close?(id: string): void };

/** True when the layout can close panes, by `onPaneClose` or `layout.close`. */
export const closes = (context: ViewContext): boolean =>
  context.onPaneClose() !== undefined ||
  (context.store as Closing).close !== undefined;

/**
 * True when a pane can close: the layout closes panes, and another pane, or
 * another visible tab of its stack, would still show.
 */
export function canClose(
  context: ViewContext,
  state: LayoutState,
  id: string
): boolean {
  const index = treeIndex(state.root);
  return (
    closes(context) &&
    (index.shown > 1 ||
      (index.panes
        .get(id)
        ?.stack?.children.some((tab) => tab.id !== id && tab.hidden !== true) ??
        false))
  );
}

/**
 * Close a pane. A tab that closes from its tab list gives the focus to the tab
 * that shows next, as the APG tabs pattern does; a close from elsewhere gives
 * it to the pane that has the focus next.
 */
export function closePane(context: ViewContext, id: string): void {
  const fromTab = document.activeElement?.getAttribute('role') === 'tab';
  const onPaneClose = context.onPaneClose();
  const pane = treeIndex(context.store.getSnapshot().root).panes.get(id)?.pane;
  if (pane === undefined) return;
  if (onPaneClose !== undefined) onPaneClose(pane);
  else (context.store as Closing).close?.(id);
  requestAnimationFrame(() => {
    const element = context.element();
    if (element === null) return;
    const focused = context.store.getSnapshot().focusedPane;
    if (fromTab) focusTab(element, focused);
    else focusPane(element, focused);
  });
}
