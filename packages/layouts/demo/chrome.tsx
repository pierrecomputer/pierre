// The pane chrome parts and `Layout.usePane`: a column of three panes with
// `Layout.Header`, `Layout.Title`, `Layout.CollapseButton`,
// `Layout.CloseButton`, and `Layout.Content`. The e2e tests use it.
//
// - `?features=none`: no `edits()`, so the close buttons warn.
// - `?render=unstable`: the app makes a new `renderPane` on each store change,
//   so `Root` warns in development.
// - `?messages=fr`: the strings of the layout in French.
// - `?start=hidden`: the notes pane starts hidden.
import { type JSX, useCallback, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import type { PaneNode } from '../src';
import * as Layout from '../src/react';
import {
  createLayout,
  edits,
  hiddenPanes,
  type LayoutMessages,
  type LayoutSeparator,
  naryTree,
  PANE_VISIBILITY_EVENT,
  type PaneVisibilityEvent,
} from '../src/react';

const params = new URLSearchParams(location.search);
const withoutFeatures = params.get('features') === 'none';
const unstableRender = params.get('render') === 'unstable';
const startHidden = params.get('start') === 'hidden';

// Each function takes named values, as an ICU message catalog does:
// "Replier {paneTitle}". The pane ID finds the form of a name that a sentence
// needs, with its article.
const FRENCH_NAMES: Readonly<Record<string, string>> = {
  editor: "l'éditeur",
  terminal: 'le terminal',
  notes: 'les notes',
};
const FRENCH: LayoutMessages = {
  layout: 'Espace de travail',
  paneCount: ({ count }) => `${count} panneaux`,
  separator: ({ beforeTitles, afterTitles }) =>
    `Redimensionner ${beforeTitles} et ${afterTitles}`,
  separatorValue: ({ percent }) => `${percent} % de la position préférée`,
  collapse: ({ paneTitle }) => `Replier ${paneTitle}`,
  close: ({ paneId, paneTitle }) =>
    `Fermer ${FRENCH_NAMES[paneId] ?? paneTitle}`,
};
const messages = params.get('messages') === 'fr' ? FRENCH : undefined;

// What the tests read: the layout object, the renders of each pane's content
// and of each pane's status line, the visibility events of each pane, the
// clicks on the app's own close handler, and the separators that
// `getSeparatorProps` received.
const page = {
  layout: createLayout(
    {
      type: 'split',
      id: 'column',
      direction: 'vertical',
      sizes: [1, 1, 1],
      children: [
        { type: 'pane', id: 'editor' },
        { type: 'pane', id: 'terminal', collapsedSize: 36 },
        { type: 'pane', id: 'notes', hidden: startHidden },
      ],
    },
    withoutFeatures ? [] : [edits(naryTree), hiddenPanes()]
  ),
  renders: {} as Record<string, number>,
  statusRenders: {} as Record<string, number>,
  visibility: {} as Record<string, boolean[]>,
  appCloseClicks: 0,
  separators: [] as LayoutSeparator[],
};
Object.assign(window, { __chrome: page });

// Count a render of a component of a pane.
function countRender(counts: Record<string, number>, id: string): void {
  counts[id] = (counts[id] ?? 0) + 1;
}

function Lines({ pane }: { pane: PaneNode }): JSX.Element {
  countRender(page.renders, pane.id);
  return (
    <>
      {Array.from({ length: 40 }, (_, line) => (
        <p key={line}>
          {pane.id} line {line + 1}
        </p>
      ))}
    </>
  );
}

// App code that reads the state of its pane: it renders only when that state
// changes.
function PaneStatus(): JSX.Element {
  const id = Layout.usePane((pane) => pane.id);
  const status = Layout.usePane((pane) =>
    [
      pane.focused && 'focused',
      pane.collapsed && 'collapsed',
      !pane.shown && 'not-shown',
    ]
      .filter(Boolean)
      .join(' ')
  );
  const edges = Layout.usePane((pane) => pane.edges);
  const tabs = Layout.usePane((pane) => pane.tabs.map((tab) => tab.id));
  countRender(page.statusRenders, id);
  return (
    <span
      className="app-status"
      data-status={status}
      data-top={edges.top}
      data-bottom={edges.bottom}
      data-tabs={tabs.join(' ')}
    >
      {status}
    </span>
  );
}

function renderPane(pane: PaneNode): JSX.Element {
  // The notes pane renders its header and its close button with the app's
  // own elements.
  const notes = pane.id === 'notes';
  return (
    <>
      <Layout.Header
        render={notes ? <header className="app-header" /> : undefined}
      >
        <Layout.Title />
        <PaneStatus />
        <Layout.CollapseButton />
        {notes ? (
          <Layout.CloseButton
            className="app-close"
            onClick={() => {
              page.appCloseClicks += 1;
            }}
            render={(props, state) => (
              <button {...props} data-app-disabled={state.disabled}>
                ✕
              </button>
            )}
          />
        ) : (
          <Layout.CloseButton />
        )}
      </Layout.Header>
      <Layout.Content
        ref={(element) => {
          // Count the visibility events that the content of each pane gets.
          const host = element?.closest('[data-layout-pane]');
          if (host == null) return;
          const listener = (event: Event) => {
            (page.visibility[pane.id] ??= []).push(
              (event as PaneVisibilityEvent).detail.hidden
            );
          };
          host.addEventListener(PANE_VISIBILITY_EVENT, listener);
          return () =>
            host.removeEventListener(PANE_VISIBILITY_EVENT, listener);
        }}
      >
        <Lines pane={pane} />
      </Layout.Content>
    </>
  );
}

const getSeparatorProps = (separator: LayoutSeparator) => {
  page.separators.push(separator);
  return {};
};

function App(): JSX.Element {
  // An app that makes a new `renderPane` on each store change, as an app
  // that reads the store in the component of the layout does.
  const state = useSyncExternalStore(
    page.layout.subscribe,
    page.layout.getSnapshot
  );
  const [stable] = useState(() => renderPane);
  const unstable = useCallback(
    (pane: PaneNode) => renderPane(pane),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [state]
  );
  return (
    <div style={{ height: '100vh' }}>
      <Layout.Root
        layout={page.layout}
        renderPane={unstableRender ? unstable : stable}
        getPaneProps={(pane) => ({ 'data-app-pane': pane.id })}
        getSeparatorProps={getSeparatorProps}
        messages={messages}
      />
    </div>
  );
}

const element = document.getElementById('root');
if (element === null) throw new Error('Missing root');
createRoot(element).render(<App />);
