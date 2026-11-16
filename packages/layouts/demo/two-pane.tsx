// App A of the modular entry points: a fixed two-pane split with a sidebar
// that collapses to 0 pixels, with `Layout.Root` only. The e2e tests use it.
// Query parameters select a variant: `form=controlled` for the controlled
// form, `stylesheets=nonce` for sheets with a nonce, and `stylesheets=none`
// for no sheets and the linked `styles.css`, and `resize=preview` for the
// internal resize strategy that moves only the separator until the release.
// "Use another layout" gives `Root` a new layout object, so that it warns.
import { type JSX, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
  type ChildSize,
  type LayoutNode,
  type PaneNode,
  replaceNode,
} from '../src';
import * as Layout from '../src/react';
import { createLayout, useControlledLayout } from '../src/react';
import { resizeStrategy } from '../src/react/features/resize-strategy';
import stylesheetUrl from '../src/styles.css?url';

const params = new URLSearchParams(location.search);
const controlledForm = params.get('form') === 'controlled';
const stylesheetsParam = params.get('stylesheets');
const stylesheets =
  stylesheetsParam === 'nonce'
    ? { nonce: 'two-pane-nonce' }
    : stylesheetsParam === 'none'
      ? null
      : undefined;
// An app that renders no sheets links the generated stylesheet, as a file.
if (stylesheets === null) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = stylesheetUrl;
  document.head.append(link);
}

const MESSAGES = { layout: 'Two-pane split' };

const initial: LayoutNode = {
  type: 'split',
  id: 'root',
  direction: 'horizontal',
  sizes: [{ px: 240 }, 1],
  children: [
    { type: 'pane', id: 'sidebar', minWidth: 160 },
    { type: 'pane', id: 'main', minWidth: 320 },
  ],
};

// What the tests read: the layout object, the sizes that `onResize`
// reported, and the renders of each pane's content.
const page = {
  layout: createLayout(
    initial,
    // The bench's resize strategies are internal features.
    params.get('resize') === 'preview' ? [resizeStrategy('preview')] : []
  ),
  resizes: [] as Readonly<Record<string, readonly ChildSize[]>>[],
  renders: {} as Record<string, number>,
};
Object.assign(window, { __twoPane: page });

function renderPane(pane: PaneNode): JSX.Element {
  page.renders[pane.id] = (page.renders[pane.id] ?? 0) + 1;
  return (
    // The app has no header, so its content is the scroll area of the pane.
    <div
      data-pane={pane.id}
      style={{ boxSizing: 'border-box', height: '100%', overflow: 'auto' }}
    >
      {Array.from({ length: 80 }, (_, line) => (
        <p key={line}>
          {pane.id} line {line + 1}
        </p>
      ))}
    </div>
  );
}

const report = (sizes: Readonly<Record<string, readonly ChildSize[]>>) => {
  page.resizes.push(sizes);
};

// The controlled form: the app owns the tree and applies each resize.
function Controlled(): JSX.Element {
  const [root, setRoot] = useState(initial);
  const layout = useControlledLayout(root);
  return (
    <Layout.Root
      layout={layout}
      renderPane={renderPane}
      messages={MESSAGES}
      stylesheets={stylesheets}
      onResize={(sizes) => {
        report(sizes);
        setRoot((current) =>
          Object.entries(sizes).reduce(
            (tree, [id, values]) =>
              replaceNode(tree, id, (node) =>
                node.type === 'split' ? { ...node, sizes: [...values] } : node
              ),
            current
          )
        );
      }}
    />
  );
}

function App(): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [layout, setLayout] = useState(page.layout);
  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <button
        type="button"
        disabled={controlledForm}
        onClick={() => {
          page.layout.setCollapsed('sidebar', !collapsed);
          setCollapsed(!collapsed);
        }}
      >
        {collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
      </button>
      <button type="button" onClick={() => setLayout(createLayout(initial))}>
        Use another layout
      </button>
      <div style={{ flex: 1, minHeight: 0 }}>
        {controlledForm ? (
          <Controlled />
        ) : (
          <Layout.Root
            layout={layout}
            renderPane={renderPane}
            messages={MESSAGES}
            stylesheets={stylesheets}
            onResize={report}
          />
        )}
      </div>
    </main>
  );
}

const element = document.getElementById('root');
if (element === null) throw new Error('Missing root');
createRoot(element).render(
  <StrictMode>
    <App />
  </StrictMode>
);
