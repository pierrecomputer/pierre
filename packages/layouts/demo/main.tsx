import {
  type CSSProperties,
  type JSX,
  useState,
  useSyncExternalStore,
} from 'react';
import { createRoot } from 'react-dom/client';

import {
  type Edge,
  getPanes,
  type LayoutNode,
  LayoutStore,
  type PaneNode,
} from '../src';
import { Layout } from '../src/react';
import '../src/styles.css';
import './style.css';

function pane(id: string): PaneNode {
  return { type: 'pane', id, minWidth: 110, minHeight: 100 };
}

const mosaic: LayoutNode = {
  type: 'split',
  id: 'columns',
  direction: 'horizontal',
  ratio: 0.33,
  first: {
    type: 'split',
    id: 'left',
    direction: 'vertical',
    ratio: 0.65,
    first: pane('1'),
    second: pane('7'),
  },
  second: {
    type: 'split',
    id: 'right',
    direction: 'vertical',
    ratio: 0.7,
    first: {
      type: 'split',
      id: 'middle',
      direction: 'vertical',
      ratio: 0.5,
      first: {
        type: 'split',
        id: 'top',
        direction: 'horizontal',
        ratio: 0.5,
        first: pane('2'),
        second: pane('5'),
      },
      second: {
        type: 'split',
        id: 'bottom',
        direction: 'horizontal',
        ratio: 0.5,
        first: pane('6'),
        second: pane('4'),
      },
    },
    second: pane('3'),
  },
};

const explorer: LayoutNode = {
  type: 'split',
  id: 'explorer-left',
  direction: 'horizontal',
  ratio: 0.2,
  first: pane('Files'),
  second: {
    type: 'split',
    id: 'explorer-main',
    direction: 'horizontal',
    ratio: 0.75,
    first: {
      type: 'split',
      id: 'explorer-terminal',
      direction: 'vertical',
      ratio: 0.75,
      first: pane('Editor'),
      second: pane('Terminal'),
    },
    second: {
      type: 'split',
      id: 'explorer-details',
      direction: 'vertical',
      ratio: 0.5,
      first: pane('History'),
      second: pane('Details'),
    },
  },
};

const store = new LayoutStore(mosaic);
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
  /^\d+$/.test(node.id) ? `Pane ${node.id}` : node.id;

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

const renderPane = (node: PaneNode): JSX.Element => <PaneContent pane={node} />;

function Playground(): JSX.Element {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const [message, setMessage] = useState('Ready to rearrange.');
  const [target, setTarget] = useState('2');
  const [edge, setEdge] = useState<Edge>('right');
  const panes = getPanes(state.root);
  const otherPanes = panes.filter(({ id }) => id !== state.focusedPane);
  const actualTarget = otherPanes.some(({ id }) => id === target)
    ? target
    : otherPanes[0]?.id;

  function addPane(direction: Edge): void {
    let id: string;
    do {
      id = String(nextPane++);
    } while (panes.some((node) => node.id === id));
    store.split(state.focusedPane, pane(id), direction);
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
        <span className="demo-badge">Experimental · 0.0.0</span>
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
          <button type="button" onClick={() => store.toggleZoom()}>
            {state.zoomedPane === null ? 'Zoom focused' : 'Restore layout'}
          </button>
        </div>
        <div className="demo-controls">
          <button type="button" onClick={() => store.setRoot(mosaic)}>
            Mosaic
          </button>
          <button type="button" onClick={() => store.setRoot(explorer)}>
            Explorer
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem('pierre-layouts-demo', store.serialize());
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
                store.restore(saved);
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
        <Layout
          store={store}
          renderPane={renderPane}
          getPaneTitle={title}
          label="Layout playground"
          style={{ '--layout-pane-background': '#fbfcfd' } as CSSProperties}
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
          onChange={(event) => setEdge(event.target.value as Edge)}
        >
          <option value="left">left of</option>
          <option value="right">right of</option>
          <option value="top">above</option>
          <option value="bottom">below</option>
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
            if (actualTarget !== undefined)
              store.move(state.focusedPane, actualTarget, edge);
          }}
        >
          Move
        </button>
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

const root = document.getElementById('root');
if (root === null) throw new Error('Missing playground root');
createRoot(root).render(<Playground />);
