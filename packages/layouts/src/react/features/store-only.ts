// Features with a store part only: their commands need no view.
import { type EditCommands, edits as editsStore } from '../../edits';
import { type HiddenPaneCommands, hiddenPanesStore } from '../../hidden-panes';
import { type PersistenceCommands, persistenceStore } from '../../persistence';
import type { TreeModel } from '../../types';
import type {
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
    announce(operation, { pane, target, messages }) {
      if (operation.type === 'close')
        return (messages.closed ?? closedText)(pane(operation.pane));
      if (operation.type === 'split')
        return (messages.opened ?? openedText)({
          ...pane(operation.pane.id),
          ...target(operation.target),
          edge: operation.edge,
        });
      if (operation.type === 'move')
        return (messages.moved ?? movedText)({
          ...pane(operation.pane),
          ...target(operation.target),
          edge: operation.edge,
        });
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
