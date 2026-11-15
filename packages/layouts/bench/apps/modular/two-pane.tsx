// Example app A on the API of feature modules: a fixed two-pane split with a
// sidebar that collapses, with `Layout.Root` only. Its sheets are inside the
// JavaScript.
import type { JSX } from 'react';

import type { PaneNode } from '../../../src';
import * as Layout from '../../../src/react';
import { createLayout } from '../../../src/react';

const layout = createLayout({
  type: 'split',
  id: 'root',
  direction: 'horizontal',
  sizes: [{ px: 240 }, 1],
  children: [
    { type: 'pane', id: 'sidebar', minWidth: 160 },
    { type: 'pane', id: 'main', minWidth: 320 },
  ],
});
const renderPane = (pane: PaneNode) => <div>{pane.id}</div>;

export function App(): JSX.Element {
  return <Layout.Root layout={layout} renderPane={renderPane} />;
}

export const toggleSidebar = (collapsed: boolean): void =>
  layout.setCollapsed('sidebar', collapsed);
