// The modes of the content of panes that do not show (`hiddenContent()`), for
// the e2e tests: a pane that hides, a stack of two tabs, and a column of two
// panes, one of which collapses. The content of each pane counts the ticks
// of an interval, its mounts, and the visibility events of its host, and has
// a field and a scroll area. It renders without StrictMode, so that a mount
// counts once.
//
// - `?mode=activity` or `?mode=unmount`: the mode of every pane; `mounted`
//   by default.
// - `?mode=kinds`: the terminal stays mounted, the log unmounts, and the
//   other panes wait in `activity`, as an app chooses by the kind of content.
import { type JSX, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { PaneNode } from '../src';
import * as Layout from '../src/react';
import {
  createLayout,
  edits,
  hiddenContent,
  hiddenPanes,
  naryTree,
  PANE_VISIBILITY_EVENT,
  type PaneVisibilityEvent,
  stacks,
  zoom,
} from '../src/react';

const params = new URLSearchParams(location.search);
const mode = params.get('mode');

const page = {
  layout: createLayout(
    {
      type: 'split',
      id: 'row',
      direction: 'horizontal',
      sizes: [1, 1, 1],
      children: [
        { type: 'pane', id: 'notes' },
        {
          type: 'stack',
          id: 'tabs',
          active: 'one',
          children: [
            { type: 'pane', id: 'one' },
            { type: 'pane', id: 'two' },
          ],
        },
        {
          type: 'split',
          id: 'column',
          direction: 'vertical',
          sizes: [1, 1],
          children: [
            { type: 'pane', id: 'terminal', collapsedSize: 40 },
            { type: 'pane', id: 'log', collapsedSize: 40 },
          ],
        },
      ],
    },
    [
      edits(naryTree),
      stacks(),
      zoom(),
      hiddenPanes(),
      ...(mode === 'activity' || mode === 'unmount'
        ? [hiddenContent(mode)]
        : mode === 'kinds'
          ? [
              hiddenContent((pane) =>
                pane.id === 'terminal'
                  ? 'mounted'
                  : pane.id === 'log'
                    ? 'unmount'
                    : 'activity'
              ),
            ]
          : []),
    ]
  ),
  ticks: {} as Record<string, number>,
  mounts: {} as Record<string, number>,
  events: {} as Record<string, boolean[]>,
};
Object.assign(window, { __hidden: page });

function Content({ id }: { id: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const contentMode = Layout.usePane((pane) => pane.hiddenContent);
  // A mount runs the initializer once; an `<Activity>` that shows again
  // does not.
  useState(() => {
    page.mounts[id] = (page.mounts[id] ?? 0) + 1;
  });
  useEffect(() => {
    const timer = setInterval(() => {
      page.ticks[id] = (page.ticks[id] ?? 0) + 1;
    }, 10);
    return () => clearInterval(timer);
  }, [id]);
  useEffect(() => {
    const host = ref.current?.closest('[data-layouts-pane]');
    const listener = (event: Event): void => {
      (page.events[id] ??= []).push(
        (event as PaneVisibilityEvent).detail.hidden
      );
    };
    host?.addEventListener(PANE_VISIBILITY_EVENT, listener);
    return () => host?.removeEventListener(PANE_VISIBILITY_EVENT, listener);
  }, [id]);
  return (
    <div ref={ref} data-mode={contentMode}>
      <input aria-label={`Field of ${id}`} />
      <div
        aria-label={`Scroll of ${id}`}
        role="region"
        style={{ height: 120, overflow: 'auto' }}
      >
        {Array.from({ length: 80 }, (_, line) => (
          <div key={line}>{`${id} line ${line}`}</div>
        ))}
      </div>
    </div>
  );
}

function TabsOrTitle(): JSX.Element {
  const stacked = Layout.usePane((pane) => pane.tabs.length > 1);
  return stacked ? <Layout.TabList /> : <Layout.Title />;
}

const renderPane = (pane: PaneNode): JSX.Element => (
  <>
    <Layout.Header>
      <TabsOrTitle />
      <Layout.CollapseButton />
      <Layout.ZoomButton />
    </Layout.Header>
    <Layout.Content>
      <Content id={pane.id} />
    </Layout.Content>
  </>
);

function App(): JSX.Element {
  return (
    <div style={{ height: '100vh' }}>
      <Layout.Root layout={page.layout} renderPane={renderPane} />
    </div>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Missing root');
createRoot(root).render(<App />);
