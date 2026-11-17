// Example app C for the bundle step: the full set of features from
// `allFeatures()`, every part in the header of each pane, and a stored tree.
// Its sheets are inside the JavaScript.
import type { JSX } from 'react';

import type { StoredLayoutTree } from '../../src';
import * as Layout from '../../src/react';
import { allFeatures, createLayout } from '../../src/react';

const layout = createLayout(
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
  allFeatures()
);

const renderPane = () => (
  <>
    <Layout.Header>
      <Layout.MoveHandle />
      <Layout.TabListScrollButton side="start" />
      <Layout.TabList />
      <Layout.TabListScrollButton side="end" />
      <Layout.CollapseButton />
      <Layout.ZoomButton />
      <Layout.CloseButton />
    </Layout.Header>
    <Layout.Content />
  </>
);

export function App(): JSX.Element {
  return <Layout.Root layout={layout} renderPane={renderPane} />;
}

export const save = (): StoredLayoutTree => layout.toStoredTree();
export const load = (tree: StoredLayoutTree): void =>
  layout.setStoredTree(tree);
