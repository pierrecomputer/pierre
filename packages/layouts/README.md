# @pierre/layouts

Experimental split-pane layouts for complex applications. A
framework-independent tree and geometry engine with a React view. The package is
private while its API is being developed.

The layout supports nested horizontal and vertical splits, tabs, constrained
resizing, two-axis corner resizing, dragging panes and tabs beside other panes,
animated zoom and restore, keyboard resizing, hidden and collapsed panes, and a
saved form of the tree. Flat keyed pane hosts preserve React state, uncontrolled
inputs, and scroll positions during rearrangement and zooming. Pane hosts keep a
stable DOM order by ID, while the split tree determines visual placement.
Closing a pane unmounts its content.

The package has two entries. `@pierre/layouts` holds the tree, the store, the
geometry, the operations, and the cover API; it needs neither the DOM nor React
to load, so a server can import it. `@pierre/layouts/react` holds the view: the
`Root` component, its parts, and its features. An app loads only the features
and parts that it imports, and each one brings its own CSS. The build has one
file for each source module, so an app's bundler puts each part in the chunk of
the code that uses it: an app that imports the root entry eagerly and the view
lazily keeps the view out of its eager chunks.

## Playground

From anywhere in the repository:

```sh
moon run layouts:dev-demo
```

The playground runs on port 4176 plus the worktree port offset. It includes a
numbered mosaic, a repo-explorer arrangement, and an agent workspace with real
content: a `@pierre/trees` file tree, an agent chat that streams its replies, an
editable `@pierre/diffs` CodeView, and an xterm.js terminal. The mosaic and the
explorer have editable notes and counters, and every view has
keyboard-accessible controls to split, move, save, and restore panes. Other
pages of the demo show each example app: `two-pane.html`, `tiled.html`,
`stacks.html`, `zoom.html`, `chrome.html`, `full.html`, `cover.html`, and the
agent app at `/app`.

## React

Import the components as a namespace and the functions by name:

```tsx
import type { PaneNode } from '@pierre/layouts';
import * as Layout from '@pierre/layouts/react';
import { createLayout, edits, naryTree, zoom } from '@pierre/layouts/react';

// Create once, outside the render function or with a lazy useState initializer.
const layout = createLayout(
  {
    type: 'split',
    id: 'workspace',
    direction: 'horizontal',
    sizes: [0.25, 0.75],
    children: [
      { type: 'pane', id: 'files', minWidth: 160 },
      { type: 'pane', id: 'editor', minWidth: 320 },
    ],
  },
  [edits(naryTree), zoom()]
);

// A stable function: each pane's content renders again only when this
// function or the pane's node changes.
const renderPane = (pane: PaneNode) => (
  <>
    <Layout.Header>
      <Layout.Title />
      <Layout.ZoomButton />
    </Layout.Header>
    <Layout.Content>{pane.id}</Layout.Content>
  </>
);

export function Workspace() {
  return (
    <div style={{ height: 600 }}>
      <Layout.Root layout={layout} renderPane={renderPane} />
    </div>
  );
}
```

`createLayout(root, features)` returns the layout object: the store, with the
core commands and the commands of each feature. `Layout.Root` renders it. A bare
`Root` with no features renders the splits, resizes them by pointer and by
keyboard, collapses panes, and announces its changes; each feature adds a
behavior, its commands, and its CSS:

| Feature         | What it adds                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `edits(model)`  | `split`, `close`, `move`, `swap`, with the rules of a tree model such as `naryTree`                          |
| `stacks()`      | Tabs: `activate`, `addTab`, `moveToStack`, `moveTab`, `setPinned`, and the keys of `Layout.TabList`          |
| `zoom()`        | `toggleZoom`, `setZoom`, `Layout.ZoomButton`, and Escape to restore                                          |
| `hiddenPanes()` | `setHidden`                                                                                                  |
| `persistence()` | `toStoredTree`, `setStoredTree`                                                                              |
| `paneDrag()`    | A pointer drag of a pane beside another, from `Layout.MoveHandle`                                            |
| `tabDrag()`     | A pointer drag of a tab: within its tab list, into another stack, or beside a pane                           |
| `corners()`     | A handle where two separators meet, which resizes both                                                       |
| `focusRing()`   | A ring around the pane that has the focus of the layout                                                      |
| `flip(options)` | Animations of tree changes and zooms, from each element's old box (`{ layout, zoom }`, both true by default) |
| `allFeatures()` | Every feature above, with `{ model, animate }` options                                                       |

A feature that needs another one gives a development warning when it is missing,
for example `stacks()` for `Layout.TabList`.

The props of `Layout.Root` are `layout`, `renderPane`, `getPaneTitle`,
`onResize`, `onPaneClose`, `getPaneProps`, `getSeparatorProps`, `stylesheets`,
`messages`, `className`, `style`, and `gap`. The layout fills its parent; give
that parent a definite height.

A focus change, a zoom, and a resize do not render pane content again: the store
keeps the identity of each node that a change does not touch, and the view
renders a pane's content only when its node or `renderPane` changes. Pass a
stable `renderPane`, for example a module function or one from `useCallback`; in
development, `Root` warns when it changes while the tree does not.
`layout.setRoot(root)` keeps each node of the store's own tree that the new tree
reuses, so an app can show or hide panes by building a new tree from the nodes
of `layout.getSnapshot().root`, and the panes that stay keep their content.

### Parts

The parts of a pane read their pane from the context that `Root` gives the
output of `renderPane`, so they take no pane prop:

- `Layout.Header`: the bar of a pane. `Layout.Title`: its title, from
  `getPaneTitle`.
- `Layout.Content`: the area that scrolls, and the target of a collapse.
- `Layout.CollapseButton`, `Layout.CloseButton`, and `Layout.ZoomButton`.
- `Layout.MoveHandle`: the handle of `paneDrag()`.
- `Layout.TabList` and `Layout.Tab`: the tabs of a stack (see "Tabs").

Each part takes a `render` prop, an element or a function of the part's props
and state, so an app gives a part its own markup and keeps the part's roles,
keys, and handlers. An app's handler on a part runs before the part's own
handler for the same event. When the app's handler calls `preventDefault()`, the
part does nothing for that event: for example, an `onKeyDown` that prevents
Delete keeps a tab open, and an `onPointerDown` that prevents the default on
`Layout.Tab` or `Layout.MoveHandle` starts no drag. `Layout.usePane(select)`
reads the state of the pane of a component: its `pane` node, `shown`, `focused`,
`zoomed`, `collapsed`, `edges`, `tabs`, and `activeTab`. The component renders
again only when the value that `select` returns changes.

```tsx
function PaneBar() {
  const zoomed = Layout.usePane((pane) => pane.zoomed);
  const top = Layout.usePane((pane) => pane.edges.top);
  return <div data-zoomed={zoomed || undefined} data-top={top || undefined} />;
}
```

### Controlled form

`Layout.useControlledLayout(tree, features)` gives a layout object that follows
a tree that the app owns. It applies each new tree before the browser paints.
The app takes the sizes of a resize from `onResize` and keeps them in its tree.

### Stylesheets

An app imports no CSS. Each module holds its CSS as a string, and the view
renders each sheet once per document, with React 19 `<style href precedence>`.
Only the features and parts in use add their sheets. With
`stylesheets={{ nonce }}`, each sheet gets the nonce of a strict content
security policy. With `stylesheets={null}`, the view renders no sheet, and the
app links the stylesheet file of the package, `@pierre/layouts/styles.css`, for
example on a static host that cannot make a nonce for each response. The file
holds every sheet that the modules inject, and nothing else. Link it with a
`<link rel="stylesheet">`; do not import it in JavaScript, which would bundle it
again for the app.

Every rule of the layout is in the cascade layer `pierre-layouts`, so the CSS of
an app without a layer wins over it at any specificity. Element defaults of an
app, such as `button { cursor: pointer; }`, then also apply to the layout's own
controls. Put them in a layer that comes before the layout's, and declare the
order once, before any stylesheet: `@layer reset, pierre-layouts;`. An app that
puts its own CSS in layers declares `@layer pierre-layouts, app;`. With Tailwind
CSS 4, whose rules are in the layers `theme`, `base`, `components`, and
`utilities`, declare
`@layer theme, base, pierre-layouts, components, utilities;` before the import
of Tailwind: its reset loses to the layout, and its utilities win over it.
Without the declaration, the layout's layer comes last, because the view adds
its sheets after the app's stylesheet, and it wins over the utilities.

Outside `Layout.Header`, `Layout.TabList` is a plain row of tabs: the app sets
its size, its overflow, and its scroll. In `Layout.Header`, it fills the header.

Style with `--layout-accent`, `--layout-border`, `--layout-pane-background`, and
`--layout-duration`. The tabs take their colors from `--layout-tab-color`,
`--layout-tab-hover-color`, `--layout-tab-hover-background`,
`--layout-tab-selected-color`, `--layout-tab-accent` (the underline of the
selected tab), and `--layout-tab-close-hover-background`.

### Messages

`messages` holds every string of the layout: the label of the layout, the names
of controls and separators, and the announcements. Each entry is a function that
returns the whole sentence, so a translation chooses its own words and word
order. A function takes one flat object of named values, which an ICU message
catalog takes as it is:

| Key                                                                        | Values                                                                                                                                    | Default                                                    |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `layout`                                                                   | (a string)                                                                                                                                | Workspace                                                  |
| `paneCount`                                                                | `count`                                                                                                                                   | 2 panes                                                    |
| `separator`                                                                | `beforeTitles`, `afterTitles` (titles joined with ", "), `beforeCount`, `afterCount`, `beforeId`, `afterId` (the first pane on each side) | Resize Files and Editor                                    |
| `separatorValue`                                                           | `percent`                                                                                                                                 | 50% preferred position                                     |
| `collapse`, `close`, `drag`, `tabs`                                        | `paneTitle`, `paneId`                                                                                                                     | Collapse Editor, Close Editor, Drag Editor, Tabs of Editor |
| `zoom`                                                                     | `paneTitle`, `paneId`, `zoomed`                                                                                                           | Zoom Editor, or Restore Editor                             |
| `zoomed`, `restored`, `closed`, `collapsed`, `expanded`, `hidden`, `shown` | `paneTitle`, `paneId`                                                                                                                     | Editor zoomed, Editor restored, …                          |
| `opened`, `moved`, `move`                                                  | `paneTitle`, `paneId`, `targetTitle`, `targetId`, `edge`                                                                                  | Terminal opened to the bottom of Editor, …                 |
| `movedToTabs`, `moveInto`                                                  | `paneTitle`, `paneId`, `targetTitle`, `targetId`                                                                                          | Editor moved into the group of Files, …                    |
| `corner`                                                                   | (a string)                                                                                                                                | Resize both axes                                           |

The titles come from `getPaneTitle`, and the IDs are the `PaneNode.id` strings
of the tree, so a translation in a language that inflects names can find the
form of a name that its sentence needs. Announcements name panes by their
titles. `Root` announces the changes of its own window, not the changes that
`applyOperations` applies from elsewhere.

```tsx
const messages: LayoutMessages = {
  layout: 'Espace de travail',
  collapse: ({ paneTitle }) => `Replier ${paneTitle}`,
  close: ({ paneId, paneTitle }) => `Fermer ${articles[paneId] ?? paneTitle}`,
};
```

### Sizes

Pane IDs and split IDs share one namespace and must be unique, non-empty
strings. Horizontal splits arrange their children left to right; vertical splits
arrange them top to bottom. A split has two or more children, and `sizes` holds
one size for each child: a positive weight, or a size in pixels such as
`{ px: 240 }`. A child with a size in pixels keeps it when the container changes
size, as a sidebar does. The other visible children share the rest of the space
of the split, without its separators, in proportion to their weights. A child
whose share is below its minimum size gets its minimum, and the others share the
rest. A pane can also have `maxWidth` and `maxHeight`: it grows to them at most,
while another weighted child can take the space. When the space shrinks, the
weighted children shrink to their minimum sizes first, then the children with
sizes in pixels.

```ts
const root: LayoutNode = {
  type: 'split',
  id: 'workspace',
  direction: 'horizontal',
  sizes: [{ px: 240 }, 1, { px: 300 }],
  children: [
    { type: 'pane', id: 'files', minWidth: 160 },
    { type: 'pane', id: 'editor', minWidth: 320 },
    { type: 'pane', id: 'chat', minWidth: 240, maxWidth: 560 },
  ],
};
```

A drag of a separator gives a child with a size in pixels its new size in
pixels, and the weighted children new weights.

The React view generates CSS container-unit expressions from the split tree. The
browser resolves panel bounds, gaps, and minimum-size constraints during
container resizing, without JavaScript measurements or React size updates. Each
edge of each box is a piecewise-linear function of the container size, so each
pane host, separator, and corner gets one short value for each property, such as
`calc(-6px + 0.25 * 100cqw)`, with one `max(0px, 100cqw - 216px)` term for each
size at which a minimum size or a gap starts to apply. The values use no custom
properties, so a size change restyles only the elements that move, not the pane
content inside them. JavaScript computes pixel geometry only for pointer and
keyboard interactions and zoom exit directions. `computeCSSLayout(root, gap)`
exposes these expressions for other CSS adapters, and `cssCorners(layout)` adds
the corners of its result. This requires browser support for container query
units and CSS size containment.

## Hidden panes

While a pane is zoomed, the other panes stay mounted. When the zoom animation
ends, each covered pane host gets `data-hidden="true"` and
`content-visibility: hidden`, so the browser skips the style, layout, and paint
of its content. The content keeps its DOM, its React state, and its scroll
position. The covered panes leave the accessibility tree and the tab order at
the start of the zoom. The zoom moves the focus into the zoomed pane first. On
restore, the view shows the panes again before the restore animation starts.

`layout.setHidden(id, true)` from `hiddenPanes()` hides a pane: it keeps its
place in the tree, its content, its state, and its scroll position, but takes no
space, and its sibling takes its box. `layout.setHidden(id, false)` shows it
again in its place, also after other panes moved, and focuses it. The last
visible pane stays visible. The hidden flag is part of the pane node, so the
saved form keeps it. A hidden pane host has `data-pane-hidden="true"`.
`onPaneClose` of `Root` replaces the close of `Layout.CloseButton`, for example
to hide the pane:

```tsx
<Layout.Root
  layout={layout}
  renderPane={renderPane}
  onPaneClose={(pane) => layout.setHidden(pane.id, true)}
/>
```

Each pane host has `contain: style`, so a hide changes no style containment. In
Chromium, such a change updates the style of the whole document. Style
containment scopes CSS counters and quotes to the pane: a counter that pane
content increments starts again in each pane.

Scripts in a hidden pane keep running. The pane host receives a
`PANE_VISIBILITY_EVENT` event when its content stops and starts rendering, so
that content such as a terminal or a chat can pause its own work. The event does
not bubble, and it comes before the paint of the change, so a listener must stay
cheap. A pane that mounts during a zoom is not hidden.

```tsx
import {
  PANE_VISIBILITY_EVENT,
  type PaneVisibilityEvent,
} from '@pierre/layouts/react';

useEffect(() => {
  const host = ref.current?.closest('[data-layout-pane]');
  if (host == null) return;
  const onVisibility = (event: Event) => {
    setPaused((event as PaneVisibilityEvent).detail.hidden);
  };
  host.addEventListener(PANE_VISIBILITY_EVENT, onVisibility);
  return () => host.removeEventListener(PANE_VISIBILITY_EVENT, onVisibility);
}, []);
```

## Tabs

A `stack` node holds two or more panes in one place, with tabs, and the ID of
its `active` pane. Only the active pane shows. The other panes keep their
content, their state, and their scroll position, with
`content-visibility: hidden`, and receive `PANE_VISIBILITY_EVENT`. Each pane
keeps its own host, so a pane that moves into or out of a stack keeps its
content. Each pane of a stack has the box of the stack, and the stack takes the
largest minimum size and the smallest maximum size of its panes, so a change of
tab moves no other box and starts no animation.

```ts
layout.addTab('terminal', { type: 'pane', id: 'server' }); // A stack in place of the terminal.
layout.activate('terminal');
layout.moveToStack('logs', 'terminal'); // Into the stack, after the terminal.
layout.moveToStack('logs', 'server', 0); // A new place among the tabs.
layout.moveTab('logs', 2); // Third among the tabs of its stack.
```

`Layout.TabList` renders the tabs of the stack of its pane, with the WAI-ARIA
tabs pattern, and makes the pane host the tab panel of its tab. A pane outside a
stack shows its own tab. Left and Right arrows move to the previous or the next
tab, Home and End to the first or the last, and the tab with the focus shows.
Delete closes the focused tab. Ctrl+Shift+PageUp and Ctrl+Shift+PageDown move
the focused tab before the previous tab or after the next one, as Firefox,
Chrome, and VS Code move their tabs; on a Mac keyboard without these keys, add
Fn to the Up and Down arrows. With `tabDrag()`, a pointer drag moves a tab in
its tab list, into another stack, or beside a pane, and a marker shows where it
goes; Escape cancels the drag. A split or a move beside a pane of a stack goes
beside the whole stack. A close or a hide of the active tab shows the nearest
tab. A stack of one pane gives way to that pane. A zoom of a tab zooms its
stack, and a change of tab keeps the zoom.

`Layout.Tab` takes a `render` prop for the app's own tab. Mark a close control
inside a tab with `data-layout-tab-close`, so that a press on it does not start
a drag; the class `pierre-layout-tab-close` gives it the close mark's style.

### Pinned tabs, and tabs that do not close

Two flags of a pane node hold the rules of an app's fixed tabs, in the tree, the
saved form, and the folds of the operations, so a server applies the same rules:

- `pinned: true`: the tab comes before the tabs that are not pinned, and stays
  in its stack. A key move, a drag, `moveTab`, `moveToStack`, and `addTab` clamp
  a place to the run of pinned tabs: a pinned tab goes at or before the end of
  the run, and another tab at or after it. A move of a pinned tab out of its
  stack (`move`, `moveToStack` into another stack, or `swap` with a pane that is
  not a pinned tab of the same stack) throws `pane_pinned`, and `tabDrag()`
  offers no such place. `layout.setPinned(id, pinned)` changes the flag and puts
  the tab at the end of the pinned run. A pinned tab has `data-pinned` and the
  description "Pinned" (`messages.pinned`).
- `closable: false`: the person cannot close the pane. Delete on its tab does
  nothing, and `Layout.CloseButton` is disabled. `layout.close(id)` from the
  app's code still closes it.

```ts
layout.addTab('files', {
  type: 'pane',
  id: 'diff',
  pinned: true,
  closable: false,
});
layout.setPinned('notes', true); // After the last pinned tab.
```

## Collapsed panes

`layout.setCollapsed(id, true)` collapses a pane to its `collapsedSize` along
its split, 0 px by default, for example the 38 px of its header and borders. Its
content keeps its DOM, its state, and its scroll position, but is inert and has
`content-visibility: hidden`, so it does not render. The pane keeps its size in
the split, and `layout.setCollapsed(id, false)` gives it back. The other
children of the split share the rest of its space, whatever the place of the
collapsed pane; when every child of a split is collapsed, they share it in equal
parts. A pane of a stack collapses its stack. The pane at the root fills the
layout, so it does not collapse. The collapsed state is part of the node, so the
saved form keeps it. A collapsed pane host has `data-collapsed="true"` and
receives `PANE_VISIBILITY_EVENT`. `Layout.CollapseButton` collapses its pane and
expands it again.

```ts
const terminal: PaneNode = {
  type: 'pane',
  id: 'terminal',
  minHeight: 100,
  collapsedSize: 38,
};
layout.setCollapsed('terminal', true);
```

## Overlays

The library supplies the cover API and no overlay component. Any dialog, drawer,
or popover of an app, or of another library, covers the panes of a layout with
`coverLayout(layout, overlay, options)` from `@pierre/layouts`: call it when the
overlay opens, and call the release that it returns when its close starts, so
that the panes render under its exit. In React,
`Layout.useCover(layout, overlayRef, open, options)` does the same while `open`
is true; `layout` is the layout object of `Layout.Root`, or a ref of the layout
element.

```tsx
const dialog = useRef<HTMLDivElement>(null);
Layout.useCover(layout, dialog, open, { onCover: setCovered });
```

- A pane inside the overlay's box stops rendering until the release: its host
  gets `data-overlay-covered`, `content-visibility: hidden`, and `inert`, and
  receives `PANE_VISIBILITY_EVENT`. A pane under two overlays renders again
  after both release it.
- `area: 'all'` covers every pane at once, for an opaque backdrop or a modal
  `<dialog>`, whose `showModal()` makes the page inert. The cover comes first,
  so the covered content gets no new style.
- `onCover({ covered, overlapped })` and `OVERLAY_COVER_EVENT` on the layout
  element report the panes inside the overlay's box and the panes that it
  crosses, when they change and at the release. A native view in a pane, such as
  an Electron view, paints over DOM overlays, so the app hides it there.

The consumer guide shows a modal pattern that keeps the page fast, and the demo
holds a reference modal and drawer on this API in `demo/overlays`, which the
`/app` demo and the bench use.

## Model and state

```ts
layout.split('editor', { type: 'pane', id: 'terminal' }, 'bottom');
layout.move('terminal', 'files', 'right');
layout.focusPane('editor');
layout.toggleZoom();
layout.close('terminal');
layout.setSizes({ workspace: [{ px: 300 }, 0.7] });

const saved = JSON.stringify(layout.toStoredTree());
layout.setStoredTree(parseStoredLayoutTree(JSON.parse(saved)));
```

The library has one saved form, `{ version: 3, root }`, from `persistence()`. It
holds the tree with its stacks, sizes in pixels, maximum sizes, and hidden and
collapsed panes, and not the focus or the zoom, which are the state of one
window. `parseStoredLayoutTree(value)` checks the core shape of untrusted data:
the fields of each node, unique IDs, and one size for each child, with the path
of a wrong field in `InvalidLayoutTreeError`. The store gives the tree the shape
of its model when it takes it. A saved tree that equals the current tree is no
change.

### Tree model

The tree model of the store sets the shape of the tree and how a split and a
close change it. `naryTree` is the model: no split holds a split of the same
direction, so each visual row or column is one node. A split of a pane to its
left or right, in a row, adds the new pane to the row with half of the pane's
size. A close gives the size of a pane to the nearest visible child before it,
or after it when there is none. A drag of a separator changes only the panes
beside it until one of them reaches its minimum size. The `TreeModel` interface
is the seam for another model. `edits(naryTree)` gives the store its model; the
store gives each tree that it receives the shape of the model, for example by
joining a split into a parent of the same direction. A pane keeps its node, so
its content does not render again.

### Stores without a view

`createLayoutStore(root, features)` from `@pierre/layouts` creates a store
without the view, for a server, a test, or another view. Without features, the
store has the core commands only: `getSnapshot`, `subscribe`, `setRoot`,
`setSizes`, `setCollapsed`, `focusPane`, `transient`, and `revert`, and it keeps
the shape of each tree that it receives. Each store feature adds its commands:

| Feature        | Commands                                                        |
| -------------- | --------------------------------------------------------------- |
| `edits(model)` | `split`, `close`, `move`, `swap`; the store gets the tree model |
| `stacks`       | `activate`, `addTab`, `moveToStack`, `moveTab`, `setPinned`     |
| `zoom`         | `toggleZoom`, `setZoom`                                         |
| `hiddenPanes`  | `setHidden`                                                     |
| `persistence`  | `toStoredTree`, `setStoredTree`                                 |

A bundler keeps only the features that an app imports, so a store with no tree
edits loads no tree model. A move of a tab into another stack takes the pane out
of its place with the tree model, so it needs `edits`. A feature is a
`StoreFeature`: an optional tree model, a function that builds its commands from
the `StoreContext` of the store, and the folds of its operations.

Read with `layout.getSnapshot()`. Snapshots are immutable. Invalid tree updates
throw before changing state. A close or a hide of the last pane that is not
hidden throws `last_pane`: `canClose(root, id)` gives the rule. Closing a
focused or zoomed pane repairs the selection. Persistence is caller-owned; the
playground uses local storage.

### Operations

Each change reaches `layout.subscribe` with its operations and its origin. An
operation is plain JSON: a tree operation (`setRoot`, `resize`, `collapse`,
`split`, `close`, `move`, `swap`, `activate`, `addTab`, `moveToStack`,
`moveTab`, `setPinned`, `hide`) changes the saved tree, and a window operation
(`focus`, `zoom`) changes the state of one window. A command that changes
nothing gives no change.

```ts
import { applyOperations, isTreeOperation } from '@pierre/layouts';

layout.subscribe(({ operations, origin }) => {
  // No echo of a change from the server, and no frame of a gesture.
  if (origin !== 'local') return;
  const tree = operations.filter(isTreeOperation);
  if (tree.length > 0) send(tree);
});

// The server's tree, as a remote change: it keeps this window's focus.
applyOperations(layout, [{ type: 'setRoot', root: response.tree.root }]);
```

- A gesture, such as a resize drag, changes the layout in each frame with
  `layout.transient(run)`: the listeners get those changes with no operations.
  It ends with one operation, or with `layout.revert()`, which restores the
  settled state. One key press on a separator is one `resize`.
- A new split or stack gets an ID `<kind>-<random prefix of the store>-<count>`,
  which its operation carries, so a server that folds the operation makes the
  same node. `createLayoutStore(root, features, { newId })` takes another maker,
  for a test.
- `applyOperations(layout, operations)` applies operations from elsewhere in one
  change, `remote` by default. A tree operation does not move the focus, and a
  remote change ends the zoom only when the zoomed pane stops showing. A local
  structural edit ends the zoom. A remote `setRoot` keeps each node that equals
  the current one, so a tree that equals the current tree is no change: no
  listener runs, and no pane content renders.
- On a server, `parseLayoutOperations(value)` checks operations from a client,
  with the path of each wrong field, and
  `applyLayoutOperations(root, operations)` folds them on the stored tree, with
  the same IDs as the client. A refused operation throws `LayoutOperationError`
  with a code: `pane_not_found`, `node_not_found`, `last_pane`, `invalid_sizes`,
  `id_in_use`, `pane_pinned`, or `unknown_operation`.
- Undo keeps the settled states: a listener that skips transient and remote
  changes pushes the state before each local change, and an undo sets that tree
  again with `setRoot`.

`computeLayout(root, width, height, gap)` returns pane rectangles and separators
for other rendering adapters, and `pixelCorners(geometry, gap)` adds the corner
intersections. Corners are a separate pass, so an adapter without corners does
not compute them. Pane minimums default to 120 × 80 pixels. When minimums cannot
fit, the engine shares the shortage proportionally without creating negative
dimensions or overflow. Preferred sizes survive temporary viewport constraints.

## Keyboard and motion

A drag of a separator changes the two children of its split beside it. When one
of them reaches its minimum size, the next child on that side gives the space,
and so on. Resize separators with arrow keys; hold Shift for larger steps. Home
and End move a separator until the child before or after it has its minimum
size; Enter gives the two children beside it the same size. Corner controls
accept arrows on both axes. Escape cancels an active gesture, and restores a
zoomed layout with `zoom()`, unless pane content handled it with
`preventDefault()`. Hidden panes remain mounted but are inert and excluded from
the accessibility tree. Motion respects `prefers-reduced-motion`.

Each pane host clips its content at its rounded border with `overflow: clip`.
From 6 visible panes, each pane host is its own compositor layer
(`transform: translateZ(0)`): an update in one pane then costs Blink less
compositing work. With fewer panes, the layers cost tile memory and save no
measured time. Keep `--layout-pane-background` opaque, so that text in a layer
keeps subpixel antialiasing. The host never scrolls; `Layout.Content` scrolls.
Put a menu or a tooltip that must extend past its pane in the top layer, with
`popover` or `<dialog>`. The content of a pane sits in a wrapper with an
identity transform, so `position: fixed` in pane content is fixed to the pane.
While a pane changes size in an animation of `flip()`, the wrapper takes the
inverse of the pane's scale, so text and headers keep their shape and the pane's
frame reveals or clips its content.

Discrete layout changes animate with transforms from each element's old box
(FLIP), so the compositor runs them and pane content lays out once; continuous
container resizing has no easing. This is an initial web implementation, not a
claim of matching native CoreAnimation's per-frame performance.

The sheets are in `src/css`, one for each feature or part of the view, and a
module imports its sheet as a string with `?inline`. `styles.css` is generated
from them: do not change it; change a sheet, then run
`moon run layouts:generate-styles`. A unit test checks that `styles.css` is
current and holds each sheet that a module injects, and nothing else.

## References

The interaction direction comes from Mitchell Hashimoto's split-layout demos:

- [Original framework demo](https://x.com/mitchellh/status/2070273858154987537)
- [Corner resizing, animated focus, and cross-window moves](https://x.com/mitchellh/status/2071657456854605869)
- [Zoom and edge-directed exits](https://x.com/mitchellh/status/2071688415524049208)

This package contains an original implementation; no source from those demos is
vendored.

## Verification

```sh
moon run layouts:test layouts:typecheck layouts:build layouts:build-demo
moon run layouts:test-e2e
moon run root:format root:lint root:check-licenses
```

## Consumer controls and persistence

See [the consumer guide](./consumer-guide.md) for an app's own pane header, pane
host attributes, the saved form, the sync with a server, resize reports, props
for separators and pane hosts, and a modal pattern over a layout. The
`/consumer.html` demo shows these controls.
