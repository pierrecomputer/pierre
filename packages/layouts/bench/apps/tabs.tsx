// Example app E for the bundle step: an editor with two stacks of tabs that
// the user selects, closes, and drags, with `Layout.TabList`, `stacks()`, and
// `tabDrag()`. Its sheets are inside the JavaScript.
import type { JSX } from 'react';

import type { PaneNode } from '../../src';
import * as Layout from '../../src/react';
import {
  createLayout,
  edits,
  naryTree,
  stacks,
  tabDrag,
} from '../../src/react';

const stack = (id: string, ids: readonly string[]) => ({
  type: 'stack' as const,
  id,
  active: ids[0],
  children: ids.map((pane) => ({ type: 'pane' as const, id: pane })),
});

const layout = createLayout(
  {
    type: 'split',
    id: 'row',
    direction: 'horizontal',
    sizes: [1, 1],
    children: [
      stack('left', ['main', 'util', 'test']),
      stack('right', ['notes', 'logs']),
    ],
  },
  [edits(naryTree), stacks(), tabDrag()]
);
const renderPane = (pane: PaneNode) => (
  <>
    <Layout.Header>
      <Layout.TabList />
      <Layout.CloseButton />
    </Layout.Header>
    <Layout.Content>{pane.id}</Layout.Content>
  </>
);

export function App(): JSX.Element {
  return <Layout.Root layout={layout} renderPane={renderPane} />;
}

export const open = (): void =>
  layout.addTab('main', { type: 'pane', id: 'readme' });
