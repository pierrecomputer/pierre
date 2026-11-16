// App B of the modular entry points: a tiled grid of four panes that the user
// moves with `Layout.MoveHandle` and resizes from the corner, with `paneDrag()`,
// `corners()`, and `zoom()`. The e2e tests use it.
//
// - `?features=noedits`: `paneDrag()` without `edits()`, so it warns.
// - `?features=nodrag`: no `paneDrag()`, so the move handles warn.
import { type JSX, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { PaneNode } from '../src';
import * as Layout from '../src/react';
import {
  corners,
  createLayout,
  edits,
  type Feature,
  naryTree,
  paneDrag,
  zoom,
} from '../src/react';

const featuresParam = new URLSearchParams(location.search).get('features');
const features: Feature[] = [
  ...(featuresParam === 'noedits' ? [] : [edits(naryTree)]),
  ...(featuresParam === 'nodrag' ? [] : [paneDrag()]),
  corners(),
  zoom(),
];

const page = {
  layout: createLayout(
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
    features
  ),
};
Object.assign(window, { __tiled: page });

const TITLES: Record<string, string> = {
  a: 'Alpha',
  b: 'Beta',
  c: 'Gamma',
  d: 'Delta',
};
const getPaneTitle = (pane: PaneNode): string => TITLES[pane.id] ?? pane.id;

function renderPane(): JSX.Element {
  return (
    <>
      <Layout.Header>
        <Layout.MoveHandle />
        <Layout.Title />
        <Layout.ZoomButton />
      </Layout.Header>
      <Layout.Content />
    </>
  );
}

function App(): JSX.Element {
  const [stable] = useState(() => renderPane);
  return (
    <div style={{ height: '100vh' }}>
      <Layout.Root
        layout={page.layout}
        renderPane={stable}
        getPaneTitle={getPaneTitle}
      />
    </div>
  );
}

const element = document.getElementById('root');
if (element === null) throw new Error('Missing root');
createRoot(element).render(
  <StrictMode>
    <App />
  </StrictMode>
);
