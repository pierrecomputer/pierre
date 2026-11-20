import {
  type JSX,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  getPanes,
  type LayoutNode,
  LayoutStore,
  naryTree,
  type PaneNode,
} from '../../src';
import { Layout, type PaneAction } from '../../src/react';
import AgentPane from '../agent';
import { ModelSelect } from '../model-select';
import { ResizeSelect, type ResizeStrategy } from '../resize-select';
import { AppOverlays } from './overlays';
import { Sessions, useSessions } from './sessions';
import './app.css';

// The header toggles. Each toggle hides or shows the panes of one place:
// the agent chat and the terminal have tabs.
const PLACES = [
  { label: 'Sessions', ids: ['sessions'] },
  { label: 'Agent', ids: ['agent', 'agent-review'] },
  { label: 'Editor', ids: ['editor'] },
  { label: 'Terminal', ids: ['terminal', 'terminal-server'] },
  { label: 'Files', ids: ['files'] },
] as const;

const LABELS: Record<string, string> = {
  sessions: 'Sessions',
  'agent-review': 'Review',
  editor: 'Editor',
  terminal: 'Terminal',
  'terminal-server': 'Dev server',
  files: 'Files',
};

// Every pane of the app, in place. A toggle hides a place or shows it again.
// The binary model nests the row as sessions | (agent | (tools | files)).
// The sessions and the files are sidebars: they keep their widths in pixels
// when the window changes size, and the agent chat and the tools share the
// rest. The files grow to 360 px at most.
const TEMPLATE: LayoutNode = {
  type: 'split',
  id: 'app-row',
  direction: 'horizontal',
  sizes: [{ px: 240 }, 0.58, 0.42, { px: 220 }],
  children: [
    { type: 'pane', id: 'sessions', minWidth: 200, minHeight: 160 },
    {
      type: 'stack',
      id: 'app-agent',
      active: 'agent',
      children: [
        { type: 'pane', id: 'agent', minWidth: 320, minHeight: 200 },
        { type: 'pane', id: 'agent-review', minWidth: 320, minHeight: 200 },
      ],
    },
    {
      type: 'split',
      id: 'app-tools',
      direction: 'vertical',
      sizes: [0.62, 0.38],
      children: [
        { type: 'pane', id: 'editor', minWidth: 260, minHeight: 140 },
        // The terminal collapses to its header: 36 px and the borders.
        {
          type: 'stack',
          id: 'app-terminal',
          active: 'terminal',
          collapsedSize: 38,
          children: [
            { type: 'pane', id: 'terminal', minWidth: 260, minHeight: 100 },
            {
              type: 'pane',
              id: 'terminal-server',
              minWidth: 260,
              minHeight: 100,
            },
          ],
        },
      ],
    },
    {
      type: 'pane',
      id: 'files',
      minWidth: 180,
      maxWidth: 360,
      minHeight: 160,
    },
  ],
};

let nextTerminal = 1;

// Sessions is a fixed sidebar; the main agent chat can move but always
// stays; the tools and the other tabs can move, and their close button hides
// them. The terminal can also collapse to its header.
const paneActions = (pane: PaneNode): readonly PaneAction[] =>
  pane.id === 'sessions'
    ? []
    : pane.id === 'agent'
      ? ['move', 'zoom']
      : pane.id.startsWith('terminal')
        ? ['move', 'collapse', 'zoom', 'close']
        : ['move', 'zoom', 'close'];

/** Show the panes of a place again; its first pane is the active tab. */
function showPlace(ids: readonly string[]): void {
  for (const id of [...ids].reverse()) store.setHidden(id, false);
}

// The n-ary model: a drag of a separator changes only the panes beside it.
const store = new LayoutStore(TEMPLATE, { model: naryTree });

// A hidden pane keeps its content, so the close button hides it, and the
// header toggle shows it again in its place.
const hidePane = (pane: PaneNode): void => store.setHidden(pane.id, true);

// A stable function, so that a change of the app's state does not render the
// content of every pane again.
const renderPane = (pane: PaneNode): JSX.Element =>
  pane.id === 'sessions' ? <Sessions /> : <AgentPane id={pane.id} />;

/** An agent app built with the layouts library: a full window with no page scroll. */
export default function App(): JSX.Element {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const { sessions, active } = useSessions();
  const [resize, setResize] = useState<ResizeStrategy>('live');
  const [animateLayout, setAnimateLayout] = useState(true);
  const [animateZoom, setAnimateZoom] = useState(true);
  const [layers, setLayers] = useState<'on' | 'off' | 'auto'>('auto');
  const workspace = useRef<HTMLElement>(null);
  const visible = new Set(
    getPanes(state.root)
      .filter(({ hidden }) => hidden !== true)
      .map(({ id }) => id)
  );
  const placesShown = PLACES.filter(({ ids }) =>
    ids.some((id) => visible.has(id))
  ).length;
  const activeTitle =
    sessions.find(({ id }) => id === active)?.title ?? 'Agent';

  useEffect(() => {
    document.title = `${activeTitle} — Layouts app`;
  }, [activeTitle]);

  const getPaneTitle = useCallback(
    (pane: PaneNode): string =>
      pane.id === 'agent' ? activeTitle : (LABELS[pane.id] ?? pane.id),
    [activeTitle]
  );

  return (
    <div className="app">
      <header className="app-header">
        <a className="app-brand" href="/">
          <span className="app-mark" aria-hidden="true">
            ▦
          </span>
          Layouts <span>app</span>
        </a>
        <nav className="app-toggles" aria-label="Panes">
          {PLACES.map(({ label, ids }) => {
            const shown = ids.some((id) => visible.has(id));
            return (
              <button
                key={label}
                type="button"
                aria-pressed={shown}
                disabled={shown && placesShown === 1}
                onClick={() => {
                  if (!shown) showPlace(ids);
                  else for (const id of ids) store.setHidden(id, true);
                }}
              >
                {label}
              </button>
            );
          })}
        </nav>
        <div className="app-header-end">
          <button
            type="button"
            className="app-action"
            onClick={() => {
              // A new terminal is a tab beside the terminal that shows.
              const target =
                getPanes(state.root).find(
                  (pane) =>
                    pane.id.startsWith('terminal') && pane.hidden !== true
                )?.id ?? 'editor';
              const id = `terminal-${nextTerminal}`;
              LABELS[id] = `Terminal ${++nextTerminal}`;
              store.addTab(target, {
                type: 'pane',
                id,
                minWidth: 260,
                minHeight: 100,
              });
            }}
          >
            New terminal
          </button>
          <AppOverlays workspace={workspace} />
          {/* Short visible labels keep the header on one row at 1280 px; each
              control keeps its full name. */}
          <span className="app-resize" role="group" aria-label="Animate">
            Animate
            <label className="app-check">
              <input
                type="checkbox"
                aria-label="Animate panes"
                checked={animateLayout}
                onChange={(event) => setAnimateLayout(event.target.checked)}
              />
              panes
            </label>
            <label className="app-check">
              <input
                type="checkbox"
                aria-label="Animate zoom"
                checked={animateZoom}
                onChange={(event) => setAnimateZoom(event.target.checked)}
              />
              zoom
            </label>
          </span>
          <span className="app-resize">
            Layers
            <select
              aria-label="Pane layers"
              value={layers}
              onChange={(event) =>
                setLayers(event.target.value as 'on' | 'off' | 'auto')
              }
            >
              <option value="auto" title="From 6 visible panes (default)">
                auto (6+)
              </option>
              <option value="on">on</option>
              <option value="off">off</option>
            </select>
          </span>
          <span className="app-resize">
            Drag
            <ResizeSelect value={resize} onChange={setResize} />
          </span>
          <span className="app-resize">
            Tree
            <ModelSelect
              value={store.getModel()}
              onChange={(model) => store.setModel(model)}
            />
          </span>
          <a href="/">Playground</a>
        </div>
      </header>
      <main className="app-main" ref={workspace}>
        <Layout
          store={store}
          renderPane={renderPane}
          getPaneTitle={getPaneTitle}
          paneActions={paneActions}
          onPaneClose={hidePane}
          label="Agent workspace"
          experimentalResize={resize}
          animate={{ layout: animateLayout, zoom: animateZoom }}
          paneLayers={layers === 'auto' ? undefined : layers === 'on'}
        />
      </main>
    </div>
  );
}
