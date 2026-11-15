// Example app B for the bundle step: a tiled grid of four panes that the user
// moves and zooms from the pane headers, with `paneDrag()`, `corners()`, and
// `zoom()`. Its sheets are inside the JavaScript.
import type { JSX } from 'react';

import type { PaneNode } from '../../src';
import * as Layout from '../../src/react';
import {
  corners,
  createLayout,
  edits,
  naryTree,
  paneDrag,
  zoom,
} from '../../src/react';

const layout = createLayout(
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
  [edits(naryTree), paneDrag(), corners(), zoom()]
);
const renderPane = (pane: PaneNode) => (
  <>
    <Layout.Header>
      <Layout.MoveHandle />
      <Layout.Title />
      <Layout.ZoomButton />
    </Layout.Header>
    <Layout.Content>{pane.id}</Layout.Content>
  </>
);

export function App(): JSX.Element {
  return <Layout.Root layout={layout} renderPane={renderPane} />;
}

export const split = (): void =>
  layout.split('a', { type: 'pane', id: 'e' }, 'right');
