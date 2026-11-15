// Example app D for the bundle step: the side panel of an agent app. It has
// stacks with the app's own tab strip and pane header, zoom, tree edits, and a
// listener that sends the tree operations of the user to a server, which
// sends its tree back as a remote change.
import { type JSX, useCallback } from 'react';

import {
  applyOperations,
  type EditCommands,
  isTreeOperation,
  type LayoutNode,
  type LayoutTreeOperation,
  type PaneNode,
  type StackCommands,
} from '../../src';
import * as Layout from '../../src/react';
import {
  createLayout,
  edits,
  type Feature,
  type LayoutObject,
  naryTree,
  stacks,
  zoom,
  type ZoomCommands,
} from '../../src/react';

type PanelLayout = LayoutObject<
  readonly [
    Feature<EditCommands>,
    Feature<StackCommands>,
    Feature<ZoomCommands>,
  ]
>;

export function createPanelLayout(
  root: LayoutNode,
  send: (operations: LayoutTreeOperation[]) => void
): PanelLayout {
  const layout = createLayout(root, [edits(naryTree), stacks(), zoom()]);
  layout.subscribe(({ operations, origin }) => {
    if (origin !== 'local') return;
    const tree = operations.filter(isTreeOperation);
    if (tree.length > 0) send(tree);
  });
  return layout;
}

export const applyServerTree = (layout: PanelLayout, root: LayoutNode): void =>
  applyOperations(layout, [{ type: 'setRoot', root }]);

function PanelHeader({ layout }: { layout: PanelLayout }): JSX.Element {
  const tabs = Layout.usePane((pane) => pane.tabs);
  const active = Layout.usePane((pane) => pane.activeTab);
  const edges = Layout.usePane((pane) => pane.edges);
  const id = Layout.usePane((pane) => pane.id);
  return (
    <div className="app-header" data-top={edges.top || undefined}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className="app-tab"
          aria-pressed={tab.id === active}
          onClick={() => layout.activate(tab.id)}
        >
          {tab.id}
        </button>
      ))}
      <button
        type="button"
        className="app-zoom"
        onClick={() => layout.toggleZoom(id)}
      />
    </div>
  );
}

export function App({ layout }: { layout: PanelLayout }): JSX.Element {
  const renderPane = useCallback(
    (pane: PaneNode) =>
      pane.id === undefined ? null : (
        <>
          <PanelHeader layout={layout} />
          <Layout.Content>{pane.id}</Layout.Content>
        </>
      ),
    [layout]
  );
  return <Layout.Root layout={layout} gap={1} renderPane={renderPane} />;
}
