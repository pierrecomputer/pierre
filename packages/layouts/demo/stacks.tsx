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
// - `?sticky=1`: the tab lists keep their pinned tabs in view (`stickyPinned`);
//   `?sticky=room0`: at every width (`stickyPinned={{ minRoom: 0 }}`).
// - `?tabclass=relative`: each tab has an app class that sets
//   `position: relative`, as a utility class does.
// - `?tabmark=1`: each tab holds a mark with `z-index: 10` at its left edge,
//   as an app's close mark has.
// - `?scrollbuttons=1`: each header has `Layout.TabListScrollButton` before
//   and after its tab list.
// - `?reset=1`: an app's reset sets the margin and the padding of every
//   element and pseudo-element to 0, as Tailwind's preflight does.
// - `?scroll=1`: the tab lists scroll (`overflow-x: auto`), as an app's own
//   strip does, so a swipe scrolls them; `?gap=1`: they also have a 4 px gap;
//   `?fit=1`: they are as wide as their tabs, up to the room of the header.
// - `?title=1`: each header shows `Layout.Title` before its tab list, and
//   "Hide the tab lists" removes the tab lists and keeps the titles.
// - `?labels=long`: the editor and tool tabs have long names, as real files
//   and tools have.
// - `?tabmin=label`: a tab keeps at least 8 characters of its label: the tab
//   lists scroll, with scroll buttons, in place of tabs of one letter.
// - `?compact=1`: a pane outside a stack shows its title in place of a tab
//   list of one tab and its scroll buttons, so its label takes the width of
//   the header.
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
const sticky =
  params.get('sticky') === '1'
    ? true
    : params.get('sticky') === 'room0'
      ? { minRoom: 0 }
      : false;
const relativeTabs = params.get('tabclass') === 'relative';
const tabMarks = params.get('tabmark') === '1';
const reset = params.get('reset') === '1';
const scrollButtons = params.get('scrollbuttons') === '1';
if (relativeTabs || tabMarks || reset) {
  const style = document.createElement('style');
  style.textContent = `.stacks-relative-tab { position: relative; } .stacks-tab-mark { position: absolute; left: 2px; top: 4px; z-index: 10; width: 8px; height: 8px; background: red; }${reset ? ' *, ::before, ::after { margin: 0; padding: 0; }' : ''}`;
  document.head.append(style);
}
const withTitle = params.get('title') === '1';
const longLabels = params.get('labels') === 'long';
const labelMinimum = params.get('tabmin') === 'label';
const compact = params.get('compact') === '1';
if (labelMinimum) {
  const style = document.createElement('style');
  // The padding of a tab holds its close mark: 10 px before the label and 22
  // px after it.
  style.textContent = `.pierre-layouts-header .pierre-layouts-tab { min-width: calc(8ch + 32px); } .pierre-layouts-header .pierre-layouts-tabs { overflow-x: auto; scrollbar-width: none; }`;
  document.head.append(style);
}
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
  params.get('scroll') === '1' || params.get('gap') === '1'
    ? {
        overflowX: 'auto' as const,
        ...(params.get('gap') === '1' && { columnGap: 4 }),
        ...(params.get('fit') === '1' && { flex: '0 1 auto' }),
      }
    : undefined;

const TITLES: Record<string, string> = longLabels
  ? {
      main: 'SecondaryPanelTabStrip.tsx',
      util: 'panelLayoutStore.ts',
      test: 'SecondaryPanelTabStrip.layout.test.tsx',
      types: 'thread-layout-operations.ts',
      docs: 'CONTRIBUTING.md',
      files: 'Workspace files',
      terminal: 'Terminal: pnpm dev',
      output: 'Output: TypeScript',
    }
  : {
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
  ) : tabMarks ? (
    <Layout.Tab>
      <span className="stacks-tab-mark" />
      <span className="pierre-layouts-tab-title">{TITLES[tab.id]}</span>
    </Layout.Tab>
  ) : (
    <Layout.Tab className={relativeTabs ? 'stacks-relative-tab' : undefined} />
  );

/**
 * The title of a pane outside a stack, in place of its tab list of one tab
 * and its scroll buttons (`?compact=1`), and the tab list of a pane in a
 * stack.
 */
function CompactChrome({ list }: { list: JSX.Element }): JSX.Element {
  const alone = Layout.usePane((state) => state.tabs.length === 1);
  return alone ? <Layout.Title /> : list;
}

function renderPane(pane: PaneNode): JSX.Element {
  const tabList = (
    <Layout.TabList
      activation={activation}
      stickyPinned={sticky}
      style={scrollStyle}
    >
      {tabOf}
    </Layout.TabList>
  );
  const start = scrollButtons && <Layout.TabListScrollButton side="start" />;
  const end = scrollButtons && <Layout.TabListScrollButton side="end" />;
  const list = (
    <>
      {start}
      {tabList}
      {end}
    </>
  );
  const chrome =
    toolsWithoutTabList && (pane.id === 'terminal' || pane.id === 'output') ? (
      <Layout.Title />
    ) : compact ? (
      <CompactChrome list={list} />
    ) : (
      list
    );
  return (
    <>
      {withoutHeader ? (
        <div className="stacks-own-header">{chrome}</div>
      ) : (
        <Layout.Header>
          {pinned && <Layout.MoveHandle />}
          {withTitle ? (
            // The scroll buttons stay while the tab list hides and shows.
            <>
              {start}
              <Layout.Title />
              <WhileTabListsShow>{tabList}</WhileTabListsShow>
              {end}
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
