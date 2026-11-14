// Example app A for the bundle step: a fixed two-pane split with a sidebar
// that collapses. It uses the `Layout` component and the `LayoutStore` class,
// and loads the package stylesheet.
import type { JSX } from 'react';

import { LayoutStore, type PaneNode } from '../../src';
import { Layout } from '../../src/react';
import '../../src/styles.css';

const store = new LayoutStore({
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
const renderHeader = () => null;

export function App(): JSX.Element {
  return (
    <Layout store={store} renderPane={renderPane} renderHeader={renderHeader} />
  );
}

export const toggleSidebar = (collapsed: boolean): void =>
  store.setCollapsed('sidebar', collapsed);
