import { type JSX, StrictMode, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import { type ChildSize, getPanes, type PaneNode } from '../src';
import { findNode } from '../src/model';
import * as Layout from '../src/react';
import { allFeatures, createLayout, naryTree } from '../src/react';

const store = createLayout(
  {
    type: 'split',
    id: 'row',
    direction: 'horizontal',
    sizes: [1, 1],
    children: [
      {
        type: 'stack',
        id: 'documents',
        active: 'editor',
        children: [
          { type: 'pane', id: 'editor' },
          { type: 'pane', id: 'preview' },
        ],
      },
      { type: 'pane', id: 'terminal' },
    ],
  },
  allFeatures({ model: naryTree, animate: false })
);

// A tab can close when another pane would still show.
const closable = (id: string): boolean =>
  getPanes(store.getSnapshot().root).some(
    (pane) => pane.id !== id && pane.hidden !== true
  );

// The app's own tab: the ID of its pane, and a close mark that closes it.
// The part keeps the roles, the keys, and the drag.
function renderTab(tab: PaneNode): JSX.Element {
  return (
    <Layout.Tab
      render={(props) => (
        <button {...props}>
          {tab.id}
          {closable(tab.id) && (
            <span
              data-layouts-tab-close=""
              aria-hidden="true"
              onClick={(event) => {
                event.stopPropagation();
                store.close(tab.id);
              }}
            >
              ×
            </span>
          )}
        </button>
      )}
    />
  );
}

// The renders of the zoom buttons, which the e2e tests read.
const page = { zoomButtonRenders: 0 };
Object.assign(window, { __consumer: page });

function countZoomButtonRender(): void {
  page.zoomButtonRenders += 1;
}

// The app's own zoom button: the layout object comes from the pane, as in an
// app with a layout for each document, and the button renders for no change
// of the layout.
function ZoomButton(): JSX.Element {
  const layout = Layout.useLayout<typeof store>();
  const id = Layout.usePane((pane) => pane.id);
  countZoomButtonRender();
  return (
    <button type="button" onClick={() => layout.toggleZoom(id)}>
      Zoom {id}
    </button>
  );
}

// The app's own header element, with the tabs of the pane and its own zoom
// button. A pane outside a stack shows its own tab.
const renderPane = (pane: PaneNode): JSX.Element => (
  <>
    <Layout.Header render={<header data-custom-header="" />}>
      <Layout.TabList>{renderTab}</Layout.TabList>
      <ZoomButton />
    </Layout.Header>
    <Layout.Content>
      <input
        aria-label={`Content ${pane.id}`}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.currentTarget.value === '')
            return;
          event.preventDefault();
          event.currentTarget.value = '';
        }}
      />
    </Layout.Content>
  </>
);

function Consumer(): JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [resizes, setResizes] = useState<
    Readonly<Record<string, readonly ChildSize[]>>[]
  >([]);
  const [mounted, setMounted] = useState(true);
  const [appKeys, setAppKeys] = useState(0);
  return (
    <>
      <button id="outside" onClick={() => store.toggleZoom('terminal')}>
        External zoom
      </button>
      <button onClick={() => store.setRoot({ type: 'pane', id: 'only' })}>
        Single pane
      </button>
      <button id="mount" onClick={() => setMounted((on) => !on)}>
        {mounted ? 'Unmount layout' : 'Mount layout'}
      </button>
      {/* An app key handler above the layout: it counts the keys that reach it. */}
      <div onKeyDown={() => setAppKeys((count) => count + 1)}>
        {mounted && (
          <Layout.Root
            layout={store}
            style={{ width: 1000, height: 600 }}
            renderPane={renderPane}
            getPaneProps={(pane) => ({
              className: 'consumer-pane',
              'data-drop-target': pane.id === 'terminal' ? undefined : pane.id,
            })}
            getSeparatorProps={(separator) => ({
              'aria-label': `Resize the ${separator.splitId} split`,
              className: 'consumer-separator',
              children: <span data-separator-grip="" />,
              onDoubleClick: () => {
                const split = findNode(
                  store.getSnapshot().root,
                  separator.splitId
                );
                if (split?.type === 'split')
                  store.setSizes({
                    [split.id]: split.children.map(() => 1),
                  });
              },
            })}
            onResize={(sizes) => setResizes((previous) => [...previous, sizes])}
          />
        )}
      </div>
      <pre id="tree">{JSON.stringify(state.root)}</pre>
      <pre id="resizes">{JSON.stringify(resizes)}</pre>
      <pre id="app-keys">{appKeys}</pre>
    </>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Missing consumer root');
createRoot(root).render(
  <StrictMode>
    <Consumer />
  </StrictMode>
);
