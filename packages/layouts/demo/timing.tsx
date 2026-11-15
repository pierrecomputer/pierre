// The timing of `PANE_VISIBILITY_EVENT` against the paint of the frame that
// shows the change, for `Layout.Root`. The e2e tests use it.
//
// Each click on the page, and each change from a timer, starts a mark: a
// frame callback, and a message from it that runs after the paint of that
// frame. Each event records whether the frame callback and the paint came
// before it.
import { type JSX, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import type { LayoutNode, PaneNode } from '../src';
import * as Layout from '../src/react';
import {
  createLayout,
  edits,
  type Feature,
  hiddenPanes,
  naryTree,
  PANE_VISIBILITY_EVENT,
  type PaneVisibilityEvent,
} from '../src/react';
import { type StackCommands, stacks } from '../src/stacks';

const tree: LayoutNode = {
  type: 'split',
  id: 'row',
  direction: 'horizontal',
  sizes: [1, 1, 1],
  children: [
    { type: 'pane', id: 'editor' },
    {
      type: 'stack',
      id: 'tabs',
      active: 'logs',
      children: [
        { type: 'pane', id: 'logs' },
        { type: 'pane', id: 'output' },
      ],
    },
    { type: 'pane', id: 'terminal', collapsedSize: 36 },
  ],
};

interface Mark {
  trigger: string;
  frame: boolean;
  paint: boolean;
}

interface EventRecord {
  pane: string;
  hidden: boolean;
  trigger: string;
  beforeFrame: boolean;
  beforePaint: boolean;
}

let mark: Mark = { trigger: 'none', frame: true, paint: true };

function startMark(trigger: string): void {
  const next: Mark = { trigger, frame: false, paint: false };
  mark = next;
  requestAnimationFrame(() => {
    next.frame = true;
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      next.paint = true;
    };
    channel.port2.postMessage(null);
  });
}

document.addEventListener('click', () => startMark('click'), true);

const stackCommands: Feature<StackCommands> = { name: 'stacks', store: stacks };
const layout = createLayout(tree, [
  edits(naryTree),
  stackCommands,
  hiddenPanes(),
]);

const page = {
  records: [] as EventRecord[],
  /** Hide or show a pane from a timer, outside a React event. */
  setHiddenLater(id: string, hidden: boolean): void {
    setTimeout(() => {
      startMark('timer');
      layout.setHidden(id, hidden);
    }, 0);
  },
};
Object.assign(window, { __timing: page });

function record(pane: string, event: PaneVisibilityEvent): void {
  page.records.push({
    pane,
    hidden: event.detail.hidden,
    trigger: mark.trigger,
    beforeFrame: !mark.frame,
    beforePaint: !mark.paint,
  });
}

function content(pane: PaneNode): JSX.Element {
  return <p>{pane.id}</p>;
}

function renderPane(pane: PaneNode): JSX.Element {
  return (
    <>
      <Layout.Header>
        <Layout.Title />
        <Layout.CollapseButton />
      </Layout.Header>
      <Layout.Content>{content(pane)}</Layout.Content>
    </>
  );
}

function App(): JSX.Element {
  useEffect(() => {
    for (const host of document.querySelectorAll<HTMLElement>(
      '[data-layout-pane]'
    )) {
      const pane = host.dataset.layoutPane ?? '';
      host.addEventListener(PANE_VISIBILITY_EVENT, (event) =>
        record(pane, event as PaneVisibilityEvent)
      );
    }
  }, []);
  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <button type="button" onClick={() => layout.activate('output')}>
        Show output
      </button>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Layout.Root layout={layout} renderPane={renderPane} />
      </div>
    </main>
  );
}

const element = document.getElementById('root');
if (element === null) throw new Error('Missing root');
createRoot(element).render(<App />);
