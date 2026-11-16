// Close a pane or a tab: the app's `onPaneClose`, or `layout.close` from
// `edits()`.
import { focusPane, focusTab } from '../../dom/panes';
import { canClose as treeCanClose } from '../../model';
import { treeIndex } from '../../tree-index';
import type { LayoutState } from '../../types';
import type { ViewContext } from '../contract';

type Closing = { close?(id: string): void };

/** True when the layout can close panes, by `onPaneClose` or `layout.close`. */
export const closes = (context: ViewContext): boolean =>
  context.onPaneClose() !== undefined ||
  (context.store as Closing).close !== undefined;

/**
 * True when the person can close a pane: the layout closes panes, the pane is
 * not `closable: false`, and the one rule of the core holds (another pane
 * that is not hidden stays).
 */
export const canClose = (
  context: ViewContext,
  state: LayoutState,
  id: string
): boolean =>
  closes(context) &&
  treeIndex(state.root).panes.get(id)?.pane.closable !== false &&
  treeCanClose(state.root, id);

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
