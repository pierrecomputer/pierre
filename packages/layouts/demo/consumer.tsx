import { type JSX, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import {
  type ChildSize,
  LayoutStore,
  naryTree,
  toLayoutNodeView,
} from '../src';
import {
  Layout,
  type LayoutResizeSession,
  type PaneHeaderProps,
} from '../src/react';
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

// Moves the separator of each split of two weighted children to the nearest
// eighth of the split, between one eighth and seven eighths.
function snapToEighths(
  sizes: Record<string, ChildSize[]>
): Record<string, ChildSize[]> {
  return Object.fromEntries(
    Object.entries(sizes).map(([id, split]) => {
      const [before, after] = split;
      if (
        split.length !== 2 ||
        typeof before !== 'number' ||
        typeof after !== 'number'
      )
        return [id, split];
      const eighths = Math.round((8 * before) / (before + after));
      const share = Math.min(7, Math.max(1, eighths)) / 8;
      return [id, [share, 1 - share]];
    })
  );
}

function Consumer(): JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [resizes, setResizes] = useState<
    Readonly<Record<string, readonly ChildSize[]>>[]
  >([]);
  const [sessions, setSessions] = useState<string[]>([]);
  const [snap, setSnap] = useState(false);
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
      <button aria-pressed={snap} onClick={() => setSnap((on) => !on)}>
        Snap to eighths
      </button>
      <button id="mount" onClick={() => setMounted((on) => !on)}>
        {mounted ? 'Unmount layout' : 'Mount layout'}
      </button>
      {/* An app key handler above the layout: it counts the keys that reach it. */}
      <div onKeyDown={() => setAppKeys((count) => count + 1)}>
        {mounted && (
          <Layout
            store={store}
            style={{ width: 1000, height: 600 }}
            animate={false}
            loneTabStrip
            renderHeader={Header}
            renderPane={(pane) => (
              <input
                aria-label={`Content ${pane.id}`}
                // Escape clears the input first; the layout then leaves it alone.
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Escape' ||
                    event.currentTarget.value === ''
                  )
                    return;
                  event.preventDefault();
                  event.currentTarget.value = '';
                }}
              />
            )}
            // The terminal host is structural: no drop target, no tab stop.
            getPaneProps={(pane) => ({
              className: 'consumer-pane',
              'data-drop-target': pane.id === 'terminal' ? undefined : pane.id,
              tabIndex: pane.id === 'terminal' ? -1 : undefined,
            })}
            getSeparatorProps={(separator) => ({
              'aria-label': `Resize the ${separator.split.id} split`,
              className: 'consumer-separator',
              children: <span data-separator-grip="" />,
              onDoubleClick: () =>
                store.setSizes({
                  [separator.split.id]: separator.split.children.map(() => 1),
                }),
            })}
            onResizeStart={({ source }): LayoutResizeSession => ({
              update: snap ? (sizes) => snapToEighths(sizes) : undefined,
              end: (cancelled) =>
                setSessions((previous) => [
                  ...previous,
                  `${source} ${cancelled ? 'cancelled' : 'applied'}`,
                ]),
            })}
            onResize={(sizes) => setResizes((previous) => [...previous, sizes])}
          />
        )}
      </div>
      <pre id="tree">{JSON.stringify(toLayoutNodeView(state.root))}</pre>
      <pre id="resizes">{JSON.stringify(resizes)}</pre>
      <pre id="sessions">{JSON.stringify(sessions)}</pre>
      <pre id="app-keys">{appKeys}</pre>
    </>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Missing consumer root');
createRoot(root).render(<Consumer />);
