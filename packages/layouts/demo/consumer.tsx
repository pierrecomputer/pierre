import { type JSX, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import {
  type ChildSize,
  LayoutStore,
  naryTree,
  toLayoutNodeView,
} from '../src';
import { Layout, type PaneHeaderProps } from '../src/react';
import '../src/styles.css';

const store = new LayoutStore(
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
  { model: naryTree }
);

function Header(header: PaneHeaderProps): JSX.Element {
  return (
    <header className="pierre-layout-header" data-custom-header="">
      <div {...header.tablistProps} className="pierre-layout-tabs">
        {header.tabs.map((tab) => (
          <button
            key={tab.id}
            {...header.getTabProps(tab)}
            className="pierre-layout-tab"
          >
            {tab.id}
            {header.canClose(tab.id) && (
              <span
                data-layout-tab-close=""
                aria-hidden="true"
                onClick={(event) => {
                  event.stopPropagation();
                  header.close(tab.id);
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
      </div>
      <button onClick={() => store.toggleZoom(header.pane.id)}>
        Zoom {header.pane.id}
      </button>
    </header>
  );
}

function Consumer(): JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [resizes, setResizes] = useState<
    Readonly<Record<string, readonly ChildSize[]>>[]
  >([]);
  return (
    <>
      <button id="outside" onClick={() => store.toggleZoom('terminal')}>
        External zoom
      </button>
      <button onClick={() => store.setRoot({ type: 'pane', id: 'only' })}>
        Single pane
      </button>
      <Layout
        store={store}
        style={{ width: 1000, height: 600 }}
        animate={false}
        loneTabStrip
        renderHeader={Header}
        renderPane={(pane) => <input aria-label={`Content ${pane.id}`} />}
        onResize={(sizes) => setResizes((previous) => [...previous, sizes])}
      />
      <pre id="tree">{JSON.stringify(toLayoutNodeView(state.root))}</pre>
      <pre id="resizes">{JSON.stringify(resizes)}</pre>
    </>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Missing consumer root');
createRoot(root).render(<Consumer />);
