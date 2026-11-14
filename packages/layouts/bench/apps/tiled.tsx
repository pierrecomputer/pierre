// Example app B for the bundle step: a tiled grid of four panes that the user
// moves and zooms from the pane headers. It uses the `Layout` component and
// the `LayoutStore` class, and loads the package stylesheet.
import type { JSX } from 'react';

import { LayoutStore, naryTree, type PaneNode } from '../../src';
import { Layout, type PaneAction } from '../../src/react';
import '../../src/styles.css';

export const store: LayoutStore = new LayoutStore(
  {
    type: 'split',
    id: 'rows',
    direction: 'vertical',
    sizes: [1, 1],
    children: [
      {
        type: 'split',
        id: 'top',
        direction: 'horizontal',
        sizes: [1, 1],
        children: [
          { type: 'pane', id: 'a' },
          { type: 'pane', id: 'b' },
        ],
      },
      {
        type: 'split',
        id: 'bottom',
        direction: 'horizontal',
        sizes: [1, 1],
        children: [
          { type: 'pane', id: 'c' },
          { type: 'pane', id: 'd' },
        ],
      },
    ],
  },
  { model: naryTree }
);
const renderPane = (pane: PaneNode) => <div>{pane.id}</div>;
const paneActions: readonly PaneAction[] = ['move', 'zoom'];

export function App(): JSX.Element {
  return (
    <Layout store={store} renderPane={renderPane} paneActions={paneActions} />
  );
}

export const split = (): void =>
  store.split('a', { type: 'pane', id: 'e' }, 'right');
