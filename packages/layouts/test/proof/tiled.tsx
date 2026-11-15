// App B of the proof: a tiled grid that the user moves and zooms, with
// `paneDrag()`, `corners()`, and `zoom()`, as an app writes it against the
// published package.
import type { PaneNode } from '@pierre/layouts';
import * as Layout from '@pierre/layouts/react';
import {
  corners,
  createLayout,
  edits,
  naryTree,
  paneDrag,
  zoom,
} from '@pierre/layouts/react';
import type { JSX } from 'react';

const row = (id: string, ids: readonly string[]) => ({
  type: 'split' as const,
  id,
  direction: 'horizontal' as const,
  sizes: [1, 1],
  children: ids.map((pane) => ({ type: 'pane' as const, id: pane })),
});

const layout = createLayout(
  {
    type: 'split',
    id: 'rows',
    direction: 'vertical',
    sizes: [1, 1],
    children: [row('top', ['a', 'b']), row('bottom', ['c', 'd'])],
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
