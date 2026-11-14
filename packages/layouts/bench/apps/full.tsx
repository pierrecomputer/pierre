// Example app C for the bundle step: the full set of features, with stacks,
// every pane action, and a saved layout. It uses the `Layout` component and
// the `LayoutStore` class, and loads the package stylesheet.
import type { JSX } from 'react';

import { LayoutStore, naryTree, type PaneNode } from '../../src';
import { Layout, type PaneAction } from '../../src/react';
import '../../src/styles.css';

export const store: LayoutStore = new LayoutStore(
  {
    type: 'split',
    id: 'row',
    direction: 'horizontal',
    sizes: [1, 1],
    children: [
      {
        type: 'stack',
        id: 's',
        active: 'a',
        children: [
          { type: 'pane', id: 'a' },
          { type: 'pane', id: 'b' },
        ],
      },
      { type: 'pane', id: 'c' },
    ],
  },
  { model: naryTree }
);
const renderPane = (pane: PaneNode) => <div>{pane.id}</div>;
const paneActions: readonly PaneAction[] = [
  'move',
  'collapse',
  'zoom',
  'close',
];

export function App(): JSX.Element {
  return (
    <Layout store={store} renderPane={renderPane} paneActions={paneActions} />
  );
}

export const save = (): string => store.serialize();
export const load = (saved: string): void => store.restore(saved);
