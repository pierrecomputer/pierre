// `stacks()` with `Layout.TabList` and `Layout.Tab`: a stack of five editor
// tabs, a pane outside a stack, and a stack of two tool tabs. The e2e tests
// use it.
//
// - `?features=nostacks`: no `stacks()`, so the tab lists warn.
// - `?tablist=none`: no tab list in the panes of the tools stack, so
//   `stacks()` warns. The lone files pane shows its title.
// - `?nested=1`: the README.md tab holds a text field and a button of its
//   own, as a tab with a rename field or a focusable control does.
// - `?header=none`: the tab lists render without `Layout.Header`, as in an
//   app's own header.
// - `?guard=1`: the app's handlers on the tabs call `preventDefault()`: for
//   Delete on every tab, for a click on test.ts, and for a press on types.ts.
// - `?pinned=1`: main.ts and util.ts are pinned, README.md is
//   `closable: false`, and each header has `Layout.CloseButton` and
//   `Layout.MoveHandle`, with `paneDrag()`.
// - `?refuse=edges`: the layout's `canPlace` refuses the edges of the
//   panes, and keeps the targets that it gets in `__stacks.asked`.
// - `?preview=1`: the app's element follows the pointer during a tab drag;
//   `?preview=none`: no image follows it.
// - `?activation=manual`: the arrows move the focus only, and Enter or Space
//   selects.
// - `?sticky=1`: the tab lists keep their pinned tabs in view (`stickyPinned`).
// - `?scroll=1`: the tab lists scroll (`overflow-x: auto`), as an app's own
//   strip does, so a swipe scrolls them.
// - `?title=1`: each header shows `Layout.Title` before its tab list, and
//   "Hide the tab lists" removes the tab lists and keeps the titles.
import { type JSX, StrictMode, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import type { PaneNode } from '../src';
import * as Layout from '../src/react';
import {
  createLayout,
  edits,
  type Feature,
  hiddenPanes,
  naryTree,
  paneDrag,
  stacks,
  tabDrag,
  zoom,
} from '../src/react';

const params = new URLSearchParams(location.search);
const withoutStacks = params.get('features') === 'nostacks';
const toolsWithoutTabList = params.get('tablist') === 'none';
const nestedControls = params.get('nested') === '1';
const withoutHeader = params.get('header') === 'none';
const guarded = params.get('guard') === '1';
const pinned = params.get('pinned') === '1';
const activation =
  params.get('activation') === 'manual' ? 'manual' : 'automatic';
const sticky = params.get('sticky') === '1';
const withTitle = params.get('title') === '1';
// Whether the tab lists show (`?title=1`), which the app can change.
const tabLists = {
  shown: true,
  listeners: new Set<() => void>(),
  subscribe(listener: () => void): () => void {
    tabLists.listeners.add(listener);
    return () => tabLists.listeners.delete(listener);
  },
  toggle(): void {
    tabLists.shown = !tabLists.shown;
    for (const listener of tabLists.listeners) listener();
  },
};
const scrollStyle =
  params.get('scroll') === '1' ? { overflowX: 'auto' as const } : undefined;

const TITLES: Record<string, string> = {
  main: 'main.ts',
  util: 'util.ts',
  test: 'test.ts',
  types: 'types.ts',
  docs: 'README.md',
  files: 'Files',
  terminal: 'Terminal',
  output: 'Output',
};

// The places that the `canPlace` of `?refuse=edges` gets.
const asked: unknown[] = [];

const features: Feature[] = [
  edits(naryTree),
  ...(withoutStacks
    ? []
    : [
        stacks(),
        tabDrag({
          ...(params.get('preview') === 'none' && { preview: false }),
          ...(params.get('preview') === '1' && {
            preview: (tab: PaneNode) => (
              <span className="stacks-preview">Moving {TITLES[tab.id]}</span>
            ),
          }),
        }),
      ]),
  ...(pinned ? [paneDrag()] : []),
  hiddenPanes(),
  zoom(),
];

const page = {
  layout: createLayout(
    {
      type: 'split',
      id: 'row',
      direction: 'horizontal',
      sizes: [2, 1, 1],
      children: [
        {
          type: 'stack',
          id: 'editors',
          active: 'main',
          children: [
            { type: 'pane', id: 'main', ...(pinned && { pinned: true }) },
            { type: 'pane', id: 'util', ...(pinned && { pinned: true }) },
            { type: 'pane', id: 'test' },
            { type: 'pane', id: 'types' },
            { type: 'pane', id: 'docs', ...(pinned && { closable: false }) },
          ],
        },
        { type: 'pane', id: 'files' },
        {
          type: 'stack',
          id: 'tools',
          active: 'terminal',
          children: [
            { type: 'pane', id: 'terminal' },
            { type: 'pane', id: 'output' },
          ],
        },
      ],
    },
    features,
    params.get('refuse') === 'edges'
      ? {
          canPlace: (source, place) => {
            asked.push({ source: source.id, place });
            return !('beside' in place);
          },
        }
      : {}
  ),
  renders: {} as Record<string, number>,
  asked,
};
Object.assign(window, { __stacks: page });

function countRender(id: string): void {
  page.renders[id] = (page.renders[id] ?? 0) + 1;
}

function Body({ id }: { id: string }): JSX.Element {
  countRender(id);
  return <textarea aria-label={`Text of ${TITLES[id]}`} />;
}

/** A tab with a text field and a button of its own (`?nested=1`). */
function NestedTab(): JSX.Element {
  return (
    <Layout.Tab render={<div />}>
      <span>README.md</span>
      <input aria-label="Name of README.md" defaultValue="README.md" />
      <button type="button">Pin README.md</button>
    </Layout.Tab>
  );
}

/** A tab whose app handlers prevent the tab's own handlers (`?guard=1`). */
function GuardedTab({ id }: { id: string }): JSX.Element {
  return (
    <Layout.Tab
      onKeyDown={(event) => {
        if (event.key === 'Delete') event.preventDefault();
      }}
      onClick={(event) => {
        if (id === 'test') event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (id === 'types') event.preventDefault();
      }}
    />
  );
}

/** The children while the tab lists show (`?title=1`). */
function WhileTabListsShow({
  children,
}: {
  children: JSX.Element;
}): JSX.Element | null {
  const shown = useSyncExternalStore(tabLists.subscribe, () => tabLists.shown);
  return shown ? children : null;
}

const tabOf = (tab: PaneNode): JSX.Element =>
  nestedControls && tab.id === 'docs' ? (
    <NestedTab />
  ) : guarded ? (
    <GuardedTab id={tab.id} />
  ) : (
    <Layout.Tab />
  );

function renderPane(pane: PaneNode): JSX.Element {
  const chrome =
    toolsWithoutTabList && (pane.id === 'terminal' || pane.id === 'output') ? (
      <Layout.Title />
    ) : (
      <Layout.TabList
        activation={activation}
        stickyPinned={sticky}
        style={scrollStyle}
      >
        {tabOf}
      </Layout.TabList>
    );
  return (
    <>
      {withoutHeader ? (
        <div className="stacks-own-header">{chrome}</div>
      ) : (
        <Layout.Header>
          {pinned && <Layout.MoveHandle />}
          {withTitle ? (
            <>
              <Layout.Title />
              <WhileTabListsShow>{chrome}</WhileTabListsShow>
            </>
          ) : (
            chrome
          )}
          {pinned && <Layout.CloseButton />}
        </Layout.Header>
      )}
      <Layout.Content>
        <Body id={pane.id} />
      </Layout.Content>
    </>
  );
}

const getPaneTitle = (pane: PaneNode): string => TITLES[pane.id] ?? pane.id;

function App(): JSX.Element {
  const [stable] = useState(() => renderPane);
  return (
    <div style={{ height: '100vh' }}>
      {withTitle && (
        <button type="button" onClick={() => tabLists.toggle()}>
          Hide the tab lists
        </button>
      )}
      <Layout.Root
        layout={page.layout}
        renderPane={stable}
        getPaneTitle={getPaneTitle}
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
