// `stacks()` with `Layout.TabList` and `Layout.Tab`: a stack of five editor
// tabs, a pane outside a stack, and a stack of two tool tabs. The e2e tests
// use it.
//
// - `?features=nostacks`: no `stacks()`, so the tab lists warn.
// - `?tablist=none`: no tab list in the files pane, so `stacks()` warns.
import { type JSX, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { PaneNode } from '../src';
import * as Layout from '../src/react';
import {
  createLayout,
  edits,
  type Feature,
  hiddenPanes,
  naryTree,
  stacks,
  tabDrag,
  zoom,
} from '../src/react';

const params = new URLSearchParams(location.search);
const withoutStacks = params.get('features') === 'nostacks';
const filesWithoutTabList = params.get('tablist') === 'none';

const TITLES: Record<string, string> = {
  main: 'main.ts',
  util: 'util.ts',
  test: 'test.ts',
  types: 'types.ts',
  docs: 'README.md',
  files: 'Files',
  terminal: 'Terminal',
  output: 'Output',
};

const features: Feature[] = [
  edits(naryTree),
  ...(withoutStacks ? [] : [stacks(), tabDrag()]),
  hiddenPanes(),
  zoom(),
];

const page = {
  layout: createLayout(
    {
      type: 'split',
      id: 'row',
      direction: 'horizontal',
      sizes: [2, 1, 1],
      children: [
        {
          type: 'stack',
          id: 'editors',
          active: 'main',
          children: [
            { type: 'pane', id: 'main' },
            { type: 'pane', id: 'util' },
            { type: 'pane', id: 'test' },
            { type: 'pane', id: 'types' },
            { type: 'pane', id: 'docs' },
          ],
        },
        { type: 'pane', id: 'files' },
        {
          type: 'stack',
          id: 'tools',
          active: 'terminal',
          children: [
            { type: 'pane', id: 'terminal' },
            { type: 'pane', id: 'output' },
          ],
        },
      ],
    },
    features
  ),
  renders: {} as Record<string, number>,
};
Object.assign(window, { __stacks: page });

function countRender(id: string): void {
  page.renders[id] = (page.renders[id] ?? 0) + 1;
}

function Body({ id }: { id: string }): JSX.Element {
  countRender(id);
  return <textarea aria-label={`Text of ${TITLES[id]}`} />;
}

function renderPane(pane: PaneNode): JSX.Element {
  return (
    <>
      <Layout.Header>
        {filesWithoutTabList && pane.id === 'files' ? (
          <Layout.Title />
        ) : (
          <Layout.TabList />
        )}
      </Layout.Header>
      <Layout.Content>
        <Body id={pane.id} />
      </Layout.Content>
    </>
  );
}

const getPaneTitle = (pane: PaneNode): string => TITLES[pane.id] ?? pane.id;

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
createRoot(element).render(<App />);
