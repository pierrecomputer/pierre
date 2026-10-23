import {
  type JSX,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  getPanes,
  type LayoutNode,
  LayoutStore,
  type PaneNode,
} from '../../src';
import { Layout, type PaneAction } from '../../src/react';
import AgentPane from '../agent';
import { ResizeSelect, type ResizeStrategy } from '../resize-select';
import { Sessions, useSessions } from './sessions';
import './app.css';

const PANES = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'agent', label: 'Agent' },
  { id: 'editor', label: 'Editor' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'files', label: 'Files' },
] as const;

const LABELS: Record<string, string> = Object.fromEntries(
  PANES.map(({ id, label }) => [id, label])
);

// Every pane of the app, in place. A toggle hides a pane or shows it again.
const TEMPLATE: LayoutNode = {
  type: 'split',
  id: 'app-sidebar',
  direction: 'horizontal',
  ratio: 0.16,
  first: { type: 'pane', id: 'sessions', minWidth: 200, minHeight: 160 },
  second: {
    type: 'split',
    id: 'app-main',
    direction: 'horizontal',
    ratio: 0.48,
    first: { type: 'pane', id: 'agent', minWidth: 320, minHeight: 200 },
    second: {
      type: 'split',
      id: 'app-side',
      direction: 'horizontal',
      ratio: 0.66,
      first: {
        type: 'split',
        id: 'app-tools',
        direction: 'vertical',
        ratio: 0.62,
        first: { type: 'pane', id: 'editor', minWidth: 260, minHeight: 140 },
        second: { type: 'pane', id: 'terminal', minWidth: 260, minHeight: 100 },
      },
      second: { type: 'pane', id: 'files', minWidth: 180, minHeight: 160 },
    },
  },
};

// Sessions is a fixed sidebar; the agent chat can move but always stays; the
// tools can move, and their close button hides them.
const paneActions = (pane: PaneNode): readonly PaneAction[] =>
  pane.id === 'sessions'
    ? []
    : pane.id === 'agent'
      ? ['move', 'zoom']
      : ['move', 'zoom', 'close'];

const store = new LayoutStore(TEMPLATE);

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
  const visible = new Set(
    getPanes(state.root)
      .filter(({ hidden }) => hidden !== true)
      .map(({ id }) => id)
  );
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
          {PANES.map(({ id, label }) => {
            const shown = visible.has(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={shown}
                disabled={shown && visible.size === 1}
                onClick={() => store.setHidden(id, shown)}
              >
                {label}
              </button>
            );
          })}
        </nav>
        <div className="app-header-end">
          <span className="app-resize">
            Resize drag
            <ResizeSelect value={resize} onChange={setResize} />
          </span>
          <a href="/">Playground</a>
        </div>
      </header>
      <main className="app-main">
        <Layout
          store={store}
          renderPane={renderPane}
          getPaneTitle={getPaneTitle}
          paneActions={paneActions}
          onPaneClose={hidePane}
          label="Agent workspace"
          experimentalResize={resize}
        />
      </main>
    </div>
  );
}
