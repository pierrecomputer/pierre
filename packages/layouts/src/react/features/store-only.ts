// Features with a store part only: their commands need no view.
import { type EditCommands, edits as editsStore } from '../../edits';
import {
  type HiddenPaneCommands,
  hiddenPanes as hiddenPanesStore,
} from '../../hidden-panes';
import {
  type PersistenceCommands,
  persistence as persistenceStore,
} from '../../persistence';
import type { Edge, TreeModel } from '../../types';
import type { Feature } from '../contract';

const closedText = (title: string): string => `${title} closed`;
const openedText = (title: string, target: string, edge: Edge): string =>
  `${title} opened to the ${edge} of ${target}`;
const movedText = (title: string, target: string, edge: Edge): string =>
  `${title} moved to the ${edge} of ${target}`;
const hiddenText = (title: string): string => `${title} hidden`;
const shownText = (title: string): string => `${title} shown`;

/**
 * Split, close, move, and swap panes, with the rules of a tree model:
 * `edits(naryTree)`. The layout gives its trees the
 * shape of the model.
 */
export function edits(model: TreeModel): Feature<EditCommands> {
  return {
    name: 'edits',
    store: editsStore(model),
    announce(operation, { title, messages }) {
      if (operation.type === 'close')
        return (messages.closed ?? closedText)(title(operation.pane));
      if (operation.type === 'split')
        return (messages.opened ?? openedText)(
          title(operation.pane.id),
          title(operation.target),
          operation.edge
        );
      if (operation.type === 'move')
        return (messages.moved ?? movedText)(
          title(operation.pane),
          title(operation.target),
          operation.edge
        );
      return null;
    },
  };
}

/** Hide a pane and show it again: `layout.setHidden`. */
export function hiddenPanes(): Feature<HiddenPaneCommands> {
  return {
    name: 'hidden-panes',
    store: hiddenPanesStore,
    announce: (operation, { title, messages }) =>
      operation.type !== 'hide'
        ? null
        : (operation.hidden
            ? (messages.hidden ?? hiddenText)
            : (messages.shown ?? shownText))(title(operation.pane)),
  };
}

/** The saved form of a layout: `layout.toStoredTree` and `layout.setStoredTree`. */
export function persistence(): Feature<PersistenceCommands> {
  return { name: 'persistence', store: persistenceStore };
}
