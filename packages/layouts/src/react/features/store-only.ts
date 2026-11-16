// Features with a store part only: their commands need no view.
import { type EditCommands, edits as editsStore } from '../../edits';
import { type HiddenPaneCommands, hiddenPanesStore } from '../../hidden-panes';
import { findNode } from '../../model';
import { type PersistenceCommands, persistenceStore } from '../../persistence';
import type { Edge, TreeModel } from '../../types';
import type {
  AnnounceContext,
  EdgeMessageValues,
  Feature,
  FeatureModule,
  PaneMessageValues,
} from '../contract';

const closedText = ({ paneTitle }: PaneMessageValues): string =>
  `${paneTitle} closed`;
const openedText = ({ paneTitle, targetTitle, edge }: EdgeMessageValues) =>
  `${paneTitle} opened to the ${edge} of ${targetTitle}`;
const movedText = ({ paneTitle, targetTitle, edge }: EdgeMessageValues) =>
  `${paneTitle} moved to the ${edge} of ${targetTitle}`;
// "a new column at the left", or "a new row at the top".
const lineAt = (edge: Edge): string =>
  `a new ${edge === 'left' || edge === 'right' ? 'column' : 'row'} at the ${edge}`;
const openedAtEdgeText = ({
  paneTitle,
  edge,
}: PaneMessageValues & { edge: Edge }): string =>
  `${paneTitle} opened in ${lineAt(edge)}`;
const movedToEdgeText = ({
  paneTitle,
  edge,
}: PaneMessageValues & { edge: Edge }): string =>
  `${paneTitle} moved to ${lineAt(edge)}`;

/**
 * The announcement of a split or a move: beside a pane, or beside a stack,
 * named by the tab that shows, or at an edge of a split.
 */
function besideText(
  { pane, target, messages, previous }: AnnounceContext,
  id: string,
  targetId: string,
  edge: Edge,
  moved: boolean
): string {
  const node = findNode(previous.root, targetId);
  if (node?.type === 'split')
    return (
      (moved ? messages.movedToEdge : messages.openedAtEdge) ??
      (moved ? movedToEdgeText : openedAtEdgeText)
    )({ ...pane(id), edge });
  return (
    (moved ? messages.moved : messages.opened) ??
    (moved ? movedText : openedText)
  )({
    ...pane(id),
    ...target(node?.type === 'stack' ? node.active : targetId),
    edge,
  });
}

const hiddenText = ({ paneTitle }: PaneMessageValues): string =>
  `${paneTitle} hidden`;
const shownText = ({ paneTitle }: PaneMessageValues): string =>
  `${paneTitle} shown`;

/**
 * Split, close, move, and swap panes, with the rules of a tree model:
 * `edits(naryTree)`. The layout gives its trees the
 * shape of the model.
 */
export function edits(model: TreeModel): Feature<EditCommands> {
  const feature: FeatureModule<EditCommands> = {
    name: 'edits',
    store: editsStore(model),
    announce(operation, context) {
      if (operation.type === 'close')
        return (context.messages.closed ?? closedText)(
          context.pane(operation.pane)
        );
      if (operation.type === 'split' || operation.type === 'move')
        return besideText(
          context,
          operation.type === 'split' ? operation.pane.id : operation.pane,
          operation.target,
          operation.edge,
          operation.type === 'move'
        );
      return null;
    },
  };
  return feature;
}

/** Hide a pane and show it again: `layout.setHidden`. */
export function hiddenPanes(): Feature<HiddenPaneCommands> {
  const feature: FeatureModule<HiddenPaneCommands> = {
    name: 'hidden-panes',
    store: hiddenPanesStore,
    announce: (operation, { pane, messages }) =>
      operation.type !== 'hide'
        ? null
        : (operation.hidden
            ? (messages.hidden ?? hiddenText)
            : (messages.shown ?? shownText))(pane(operation.pane)),
  };
  return feature;
}

/** The saved form of a layout: `layout.toStoredTree` and `layout.setStoredTree`. */
export function persistence(): Feature<PersistenceCommands> {
  const feature: FeatureModule<PersistenceCommands> = {
    name: 'persistence',
    store: persistenceStore,
  };
  return feature;
}
