// App A of the proof: a two-pane split with `Layout.Root` only, as an app
// writes it against the published package.
import type { PaneNode } from '@pierre/layouts';
import * as Layout from '@pierre/layouts/react';
import { createLayout } from '@pierre/layouts/react';
import type { JSX } from 'react';

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
