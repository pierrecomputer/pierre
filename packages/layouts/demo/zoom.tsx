// `zoom()`, `Layout.ZoomButton`, and `focusRing()` on the API of feature
// modules: a row of a pane, a stack of two tabs, and a pane that collapses to
// its header. The e2e tests use it.
//
// - `?features=nozoom`: every feature but `zoom()`.
// - `?features=reversed`: the features in the reverse order.
// - `?requires=missing`: one more feature that needs a feature that the
//   layout lacks.
// - `?slots=conflict`: two more features that both give the style of a host.
// - `?flip=on`: `flip()` animates the zoom; `&duration=<ms>` sets its length.
import {
  type CSSProperties,
  type JSX,
  StrictMode,
  useContext,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';

import type { PaneNode } from '../src';
import { visibilityIds } from '../src/dom/visibility';
import * as Layout from '../src/react';
import {
  createLayout,
  edits,
  type Feature,
  flip,
  focusRing,
  hiddenPanes,
  naryTree,
  PANE_VISIBILITY_EVENT,
  type PaneVisibilityEvent,
  zoom,
} from '../src/react';
import {
  type FeatureModule,
  PaneContext,
  type ViewContext,
} from '../src/react/contract';
import { paneContextIds } from '../src/react/root';
import { stacks } from '../src/stacks';

const params = new URLSearchParams(location.search);
const featuresParam = params.get('features');

// A React feature with the tab commands of the store only: `stacks()` with its
// view part comes later.
const stackCommands: FeatureModule = { name: 'stacks', store: stacks() };

let features: Feature[] = [
  edits(naryTree),
  stackCommands,
  hiddenPanes(),
  ...(featuresParam === 'nozoom' ? [] : [zoom()]),
  focusRing(),
  ...(params.get('flip') === 'on' ? [flip()] : []),
];
const duration = params.get('duration');
if (featuresParam === 'reversed') features = features.toReversed();
// Features of the tests, with the members of the library's own features.
const needsDrag: FeatureModule = {
  name: 'needs-drag',
  requires: ['pane-drag'],
};
if (params.get('requires') === 'missing') features.push(needsDrag);
if (params.get('slots') === 'conflict')
  for (const name of ['first-style', 'second-style']) {
    const slot: FeatureModule = {
      name,
      use: () => ({ host: ({ rect }) => ({ style: rect }) }),
    };
    features.push(slot);
  }

// What the tests read: the layout object, and the visibility events of each
// pane.
const page = {
  layout: createLayout(
    {
      type: 'split',
      id: 'row',
      direction: 'horizontal',
      sizes: [1, 1, 1],
      children: [
        { type: 'pane', id: 'editor' },
        {
          type: 'stack',
          id: 'tabs',
          active: 'notes',
          children: [
            { type: 'pane', id: 'notes' },
            { type: 'pane', id: 'logs' },
          ],
        },
        {
          type: 'split',
          id: 'column',
          direction: 'vertical',
          sizes: [1, 1],
          children: [
            { type: 'pane', id: 'files' },
            { type: 'pane', id: 'terminal', collapsedSize: 36 },
          ],
        },
      ],
    },
    features
  ),
  visibility: {} as Record<string, boolean[]>,
  view: null as ViewContext | null,
  // The panes that the caches of the view keep, in a development build.
  cachedPanes(): { contexts: string[]; visibility: string[] } {
    const view = page.view;
    return view === null
      ? { contexts: [], visibility: [] }
      : {
          contexts: [...paneContextIds(view)].sort(),
          visibility: [...visibilityIds(view.visibility)].sort(),
        };
  },
};
Object.assign(window, { __zoom: page });

function keepView(view: ViewContext | null): void {
  page.view = view;
}

// Keep the context of the view for the tests of its caches.
function ViewProbe(): null {
  keepView(useContext(PaneContext)?.context ?? null);
  return null;
}

function renderPane(pane: PaneNode): JSX.Element {
  return (
    <>
      <ViewProbe />
      <Layout.Header>
        <Layout.Title />
        <Layout.CollapseButton />
        <Layout.ZoomButton />
      </Layout.Header>
      <Layout.Content
        ref={(element) => {
          const host = element?.closest('[data-layouts-pane]');
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
        <input aria-label={`Note in ${pane.id}`} />
        {Array.from({ length: 30 }, (_, line) => (
          <p key={line}>
            {pane.id} line {line + 1}
          </p>
        ))}
      </Layout.Content>
    </>
  );
}

function App(): JSX.Element {
  const [stable] = useState(() => renderPane);
  return (
    <div style={{ height: '100vh' }}>
      <Layout.Root
        layout={page.layout}
        renderPane={stable}
        style={
          duration === null
            ? undefined
            : ({ '--layouts-duration': `${duration}ms` } as CSSProperties)
        }
      />
    </div>
  );
}

const element = document.getElementById('root');
if (element === null) throw new Error('Missing root');
createRoot(element).render(
  <StrictMode>
    <App />
  </StrictMode>
);
