// `allFeatures()` with every part in the header of each pane. The e2e tests
// use it.
import { type JSX, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import * as Layout from '../src/react';
import { allFeatures, createLayout } from '../src/react';

const page = {
  layout: createLayout(
    {
      type: 'split',
      id: 'row',
      direction: 'horizontal',
      sizes: [1, 1],
      children: [
        {
          type: 'stack',
          id: 'tabs',
          active: 'a',
          children: [
            { type: 'pane', id: 'a' },
            { type: 'pane', id: 'b' },
          ],
        },
        {
          type: 'split',
          id: 'column',
          direction: 'vertical',
          sizes: [1, 1],
          children: [
            { type: 'pane', id: 'c' },
            { type: 'pane', id: 'd', collapsedSize: 40 },
          ],
        },
      ],
    },
    allFeatures()
  ),
};
Object.assign(window, { __full: page });

function renderPane(): JSX.Element {
  return (
    <>
      <Layout.Header>
        <Layout.MoveHandle />
        <Layout.TabList />
        <Layout.CollapseButton />
        <Layout.ZoomButton />
        <Layout.CloseButton />
      </Layout.Header>
      <Layout.Content />
    </>
  );
}

function App(): JSX.Element {
  const [stable] = useState(() => renderPane);
  return (
    <div style={{ height: '100vh' }}>
      <Layout.Root layout={page.layout} renderPane={stable} />
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
