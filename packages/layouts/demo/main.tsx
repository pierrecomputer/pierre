import {
  type CSSProperties,
  type JSX,
  lazy,
  StrictMode,
  Suspense,
  useState,
  useSyncExternalStore,
} from 'react';
import { createRoot } from 'react-dom/client';

import {
  type Edge,
  getPanes,
  type LayoutNode,
  type PaneNode,
  parseStoredLayoutTree,
} from '../src';
import * as Layout from '../src/react';
import { allFeatures, createLayout, naryTree } from '../src/react';
import { resizeStrategy } from '../src/react/features/resize-strategy';
import { ResizeSelect, type ResizeStrategy } from './resize-select';
import './style.css';

function pane(id: string): PaneNode {
  return { type: 'pane', id, minWidth: 110, minHeight: 100 };
}

// The n-ary model joins each split into a parent of the same direction.
const mosaic: LayoutNode = {
  type: 'split',
  id: 'columns',
  direction: 'horizontal',
  sizes: [0.33, 0.67],
  children: [
    {
      type: 'split',
      id: 'left',
      direction: 'vertical',
      sizes: [0.65, 0.35],
      children: [pane('1'), pane('7')],
    },
    {
      type: 'split',
      id: 'right',
      direction: 'vertical',
      sizes: [0.7, 0.3],
      children: [
        {
          type: 'split',
          id: 'middle',
          direction: 'vertical',
          sizes: [0.5, 0.5],
          children: [
            {
              type: 'split',
              id: 'top',
              direction: 'horizontal',
              sizes: [0.5, 0.5],
              children: [pane('2'), pane('5')],
            },
            {
              type: 'split',
              id: 'bottom',
              direction: 'horizontal',
              sizes: [0.5, 0.5],
              children: [pane('6'), pane('4')],
            },
          ],
        },
        pane('3'),
      ],
    },
  ],
};

const explorer: LayoutNode = {
  type: 'split',
  id: 'explorer-left',
  direction: 'horizontal',
  sizes: [0.2, 0.8],
  children: [
    pane('Files'),
    {
      type: 'split',
      id: 'explorer-main',
      direction: 'horizontal',
      sizes: [0.75, 0.25],
      children: [
        {
          type: 'split',
          id: 'explorer-terminal',
          direction: 'vertical',
          sizes: [0.75, 0.25],
          children: [pane('Editor'), pane('Terminal')],
        },
        {
          type: 'split',
          id: 'explorer-details',
          direction: 'vertical',
          sizes: [0.5, 0.5],
          children: [pane('History'), pane('Details')],
        },
      ],
    },
  ],
};

// An agent workspace with real content: files, the agent chat, and an editor
// above a terminal. Its content loads on first use.
const agent: LayoutNode = {
  type: 'split',
  id: 'agent-left',
  direction: 'horizontal',
  sizes: [0.18, 0.82],
  children: [
    { type: 'pane', id: 'files', minWidth: 160, minHeight: 100 },
    {
      type: 'split',
      id: 'agent-main',
      direction: 'horizontal',
      sizes: [0.5, 0.5],
      children: [
        { type: 'pane', id: 'agent', minWidth: 300, minHeight: 160 },
        {
          type: 'split',
          id: 'agent-tools',
          direction: 'vertical',
          sizes: [0.62, 0.38],
          children: [
            { type: 'pane', id: 'editor', minWidth: 240, minHeight: 120 },
            { type: 'pane', id: 'terminal', minWidth: 240, minHeight: 100 },
          ],
        },
      ],
    },
  ],
};

const AGENT_TITLES: Partial<Record<string, string>> = {
  files: 'Files',
  agent: 'Agent',
  editor: 'Editor',
  terminal: 'Terminal',
};

const AgentPane = lazy(() => import('./agent'));

// The resize strategy of the menu, which the internal feature of the bench
// reads at each pointer resize.
let resizeOfMenu: ResizeStrategy = 'live';
const store = createLayout(mosaic, [
  ...allFeatures({ model: naryTree }),
  resizeStrategy(() => resizeOfMenu),
]);
let nextPane = 8;
const colors = [
  '#edf2ff',
  '#fff4e8',
  '#f5edff',
  '#eaf7f0',
  '#ffedf1',
  '#e8f7fc',
  '#f0f2f6',
];
const title = (node: PaneNode): string =>
  AGENT_TITLES[node.id] ??
  (/^\d+$/.test(node.id) ? `Pane ${node.id}` : node.id);

function PaneContent({ pane: node }: { pane: PaneNode }): JSX.Element {
  const [count, setCount] = useState(0);
  const colorIndex = /^\d+$/.test(node.id)
    ? Number(node.id) - 1
    : node.id.length;
  return (
    <div
      className="demo-pane"
      style={{ background: colors[colorIndex % colors.length] }}
    >
      <div className="demo-pane-number">{node.id}</div>
      <div className="demo-pane-tools">
        <button
          type="button"
          onClick={() => setCount((value) => value + 1)}
          aria-label={`Count in ${title(node)}`}
        >
          Count {count}
        </button>
        <input
          aria-label={`Note in ${title(node)}`}
          placeholder="Leave a note…"
        />
      </div>
    </div>
  );
}

// The tabs of a pane in a stack, or the title of a lone pane, as the default
// header of the \`Layout\` component before showed them.
function TabsOrTitle({
  tab,
}: {
  tab?: (tab: PaneNode) => JSX.Element;
}): JSX.Element {
  const stacked = Layout.usePane((state) => state.tabs.length > 1);
  return stacked ? <Layout.TabList>{tab}</Layout.TabList> : <Layout.Title />;
}

// Each pane has a header with a move handle, its tabs or its title, and the
// zoom and close buttons, and its content.
const renderPane = (node: PaneNode): JSX.Element => (
  <>
    <Layout.Header>
      <Layout.MoveHandle title="Drag to move this pane beside another" />
      <TabsOrTitle />
      <Layout.ZoomButton />
      <Layout.CloseButton />
    </Layout.Header>
    <Layout.Content>
      {AGENT_TITLES[node.id] === undefined ? (
        <PaneContent pane={node} />
      ) : (
        <Suspense fallback={<div className="demo-loading">Loading…</div>}>
          <AgentPane id={node.id} />
        </Suspense>
      )}
    </Layout.Content>
  </>
);

const MESSAGES = { layout: 'Layout playground' };

function Playground(): JSX.Element {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const [message, setMessage] = useState('Ready to rearrange.');
  const [target, setTarget] = useState('2');
  // An edge, or `tabs` to move the focused pane into the target's tabs.
  const [edge, setEdge] = useState<Edge | 'tabs'>('right');
  // Experimental: how a pointer resize applies its sizes, to compare how each feels.
  const [resize, setResize] = useState<ResizeStrategy>(resizeOfMenu);
  const panes = getPanes(state.root);
  const otherPanes = panes.filter(({ id }) => id !== state.focusedPane);
  const actualTarget = otherPanes.some(({ id }) => id === target)
    ? target
    : otherPanes[0]?.id;

  function newId(): string {
    let id: string;
    do {
      id = String(nextPane++);
    } while (panes.some((node) => node.id === id));
    return id;
  }

  function addPane(direction: Edge): void {
    store.split(state.focusedPane, pane(newId()), direction);
  }

  return (
    <main>
      <header className="demo-heading">
        <div className="demo-brand">
          <span className="demo-mark">▦</span>
          <span>
            Pierre <b>/ layouts</b>
          </span>
        </div>
        <span className="demo-badge">
          <a href="/app">Open the app demo</a> · Experimental · 0.0.0
        </span>
      </header>
      <div className="demo-intro">
        <div>
          <span className="demo-eyebrow">A workspace that moves with you</span>
          <h1>Make room for anything.</h1>
        </div>
        <p>
          Split, resize, rearrange, and zoom.
          <br />
          Your content stays right where you left it.
        </p>
      </div>
      <div className="demo-toolbar" aria-label="Layout controls">
        <div className="demo-controls">
          <button type="button" onClick={() => addPane('right')}>
            Split right
          </button>
          <button type="button" onClick={() => addPane('bottom')}>
            Split down
          </button>
          <button
            type="button"
            onClick={() => store.addTab(state.focusedPane, pane(newId()))}
          >
            Add tab
          </button>
          <button type="button" onClick={() => store.toggleZoom()}>
            {state.zoomedPane === null ? 'Zoom focused' : 'Restore layout'}
          </button>
          <button type="button" onClick={() => store.focusNext()}>
            Next pane
          </button>
        </div>
        <div className="demo-controls">
          <button type="button" onClick={() => store.setRoot(mosaic)}>
            Mosaic
          </button>
          <button type="button" onClick={() => store.setRoot(explorer)}>
            Explorer
          </button>
          <button type="button" onClick={() => store.setRoot(agent)}>
            Agent
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem(
                  'pierre-layouts-demo',
                  JSON.stringify(store.toStoredTree())
                );
                setMessage('Layout saved to this browser.');
              } catch {
                setMessage('This browser could not save the layout.');
              }
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                const saved = localStorage.getItem('pierre-layouts-demo');
                if (saved === null) {
                  setMessage('Save a layout first.');
                  return;
                }
                store.setStoredTree(parseStoredLayoutTree(JSON.parse(saved)));
                setMessage('Saved layout restored.');
              } catch {
                setMessage('The saved layout could not be restored.');
              }
            }}
          >
            Load
          </button>
        </div>
      </div>
      <div className="demo-workspace">
        <Layout.Root
          layout={store}
          renderPane={renderPane}
          getPaneTitle={title}
          messages={MESSAGES}
          style={{ '--layouts-pane-background': '#fbfcfd' } as CSSProperties}
        />
      </div>
      <footer className="demo-footer">
        <span>
          <b>{panes.length} panes</b> · Focused: {state.focusedPane}
        </span>
        <span>
          Drag a grip to rearrange · Drag a dot to resize both axes · Esc to
          restore
        </span>
      </footer>
      <div className="demo-move">
        <span>Move focused pane</span>
        <select
          aria-label="Move direction"
          value={edge}
          onChange={(event) => setEdge(event.target.value as Edge | 'tabs')}
        >
          <option value="left">left of</option>
          <option value="right">right of</option>
          <option value="top">above</option>
          <option value="bottom">below</option>
          <option value="tabs">into the tabs of</option>
        </select>
        <select
          aria-label="Move target"
          value={actualTarget ?? ''}
          onChange={(event) => setTarget(event.target.value)}
          disabled={otherPanes.length === 0}
        >
          {otherPanes.map((node) => (
            <option key={node.id} value={node.id}>
              {title(node)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={actualTarget === undefined}
          onClick={() => {
            if (actualTarget === undefined) return;
            if (edge === 'tabs')
              store.moveToStack(state.focusedPane, actualTarget);
            else store.move(state.focusedPane, actualTarget, edge);
          }}
        >
          Move
        </button>
        <span>Resize drag</span>
        <ResizeSelect
          value={resize}
          onChange={(value) => {
            resizeOfMenu = value;
            setResize(value);
          }}
        />
        <span className="demo-message" role="status">
          {message}
        </span>
      </div>
      <p className="demo-help">
        Resize handles support arrow keys, Shift for larger steps, Home / End
        for limits, and Enter to balance. Notes and counters demonstrate that
        rearranging and zooming preserve pane content.
      </p>
    </main>
  );
}

// `/app` shows the layout as a full agent app; every other path shows the playground.
const AppDemo = lazy(() => import('./app'));

const root = document.getElementById('root');
if (root === null) throw new Error('Missing playground root');
createRoot(root).render(
  <StrictMode>
    {/^\/app\/?$/.test(location.pathname) ? (
      <Suspense fallback={null}>
        <AppDemo />
      </Suspense>
    ) : (
      <Playground />
    )}
  </StrictMode>
);
