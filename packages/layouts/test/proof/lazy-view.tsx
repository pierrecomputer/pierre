// The lazy module of the app of `eager-root.tsx`: a side panel with stacks,
// zoom, and tree edits, which syncs its operations and applies the tree of a
// server, as chat-bb's side panel does.
import {
  applyOperations,
  computeLayout,
  isTreeOperation,
  type LayoutNode,
} from '@pierre/layouts';
import * as Layout from '@pierre/layouts/react';
import {
  createLayout,
  edits,
  naryTree,
  stacks,
  zoom,
} from '@pierre/layouts/react';
import type { JSX } from 'react';

export function Panel({
  root,
  send,
}: {
  root: LayoutNode;
  send: (count: number) => void;
}): JSX.Element {
  const layout = createLayout(root, [edits(naryTree), stacks(), zoom()]);
  layout.subscribe(({ operations }) =>
    send(operations.filter(isTreeOperation).length)
  );
  return (
    <Layout.Root
      layout={layout}
      renderPane={(pane) => <Layout.Content>{pane.id}</Layout.Content>}
    />
  );
}

export const applyServerTree = (
  layout: ReturnType<typeof createLayout>,
  root: LayoutNode
): void => applyOperations(layout, [{ type: 'setRoot', root }]);

export const paneCount = (root: LayoutNode): number =>
  computeLayout(root, 100, 100).panes.length;
