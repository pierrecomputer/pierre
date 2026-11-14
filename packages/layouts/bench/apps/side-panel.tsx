// Example app D for the bundle step: the side panel of an agent app. It has
// stacks with a tab strip for each pane, zoom, tree edits, a store subclass
// that records the operations of the user, and the app's own pane header. It
// uses the `Layout` component and the `LayoutStore` class, and loads the
// package stylesheet.
import type { JSX } from 'react';

import {
  type LayoutNode,
  LayoutStore,
  naryTree,
  type PaneNode,
} from '../../src';
import { Layout, type PaneHeaderProps } from '../../src/react';
import '../../src/styles.css';

export class PanelLayoutStore extends LayoutStore {
  private readonly record: (operation: string) => void;

  constructor(root: LayoutNode, record: (operation: string) => void) {
    super(root, { model: naryTree });
    this.record = record;
  }

  override activate(id: string): void {
    const before = this.getSnapshot().root;
    super.activate(id);
    if (this.getSnapshot().root !== before) this.record(`select ${id}`);
  }
}

const renderPane = (pane: PaneNode) => <div>{pane.id}</div>;

const renderHeader =
  (store: PanelLayoutStore) =>
  (header: PaneHeaderProps): JSX.Element => (
    <div className="app-header">
      <div {...header.tablistProps}>
        {header.tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="app-tab"
            {...header.getTabProps(tab)}
          >
            {tab.id}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="app-zoom"
        onClick={() => store.toggleZoom(header.pane.id)}
      />
    </div>
  );

export function App({ store }: { store: PanelLayoutStore }): JSX.Element {
  return (
    <Layout
      store={store}
      gap={1}
      loneTabStrip
      animate={false}
      renderPane={renderPane}
      renderHeader={renderHeader(store)}
    />
  );
}
