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

| Feature               | What it adds                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `edits(model)`        | `split`, `close`, `move`, `swap`, with the rules of a tree model such as `naryTree`                          |
| `stacks()`            | Tabs: `activate`, `addTab`, `moveToStack`, `moveTab`, `setPinned`, and the keys of `Layout.TabList`          |
| `zoom()`              | `toggleZoom`, `setZoom`, `Layout.ZoomButton`, and Escape to restore                                          |
| `hiddenPanes()`       | `setHidden`                                                                                                  |
| `hiddenContent(mode)` | What the content of a pane does while it does not show: `mounted`, `activity`, or `unmount`                  |
| `persistence()`       | `toStoredTree`, `setStoredTree`                                                                              |
| `arrange()`           | `focusToward`, `grow`, `shrink`, and the items of `Layout.usePaneMenu()`; needs `edits()`                    |
| `paneDrag()`          | A pointer drag of a pane beside another, from `Layout.MoveHandle`                                            |
| `tabDrag()`           | A pointer drag of a tab: within its tab list, into another stack, or beside a pane                           |
| `corners()`           | A handle where two separators meet, which resizes both                                                       |
| `focusRing()`         | A ring around the pane that has the focus of the layout                                                      |
| `flip(options)`       | Animations of tree changes and zooms, from each element's old box (`{ layout, zoom }`, both true by default) |
| `allFeatures()`       | Every feature above, with `{ model, animate }` options                                                       |

A feature that needs another feature in the same layout (`arrange()`,
`paneDrag()`, and `stacks()` need `edits()`; `tabDrag()` needs `stacks()`) gives
a type error in `createLayout` when the list does not have it: "Property '"add
the feature edits()"' is missing". The check is in the types only, so it costs
no byte; a development build also warns. A list typed as `Feature[]` names no
feature, so it gets no type check. A part whose feature is missing gives a
development warning, for example `Layout.TabList` without `stacks()`. A feature
is a value of the type `Feature`, which an app names and passes; its members are
internal, so an app does not write its own feature yet.

The root entry also exports `edits`, `stacks`, `zoom`, `hiddenPanes`,
`persistence`, and `naryTree`, for `createLayoutStore` on a server or in a test.
Those store features are not features of `createLayout`: one of them in the list
of `createLayout` fails with TS2559, "Type 'StoreFeature<EditCommands>' has no
properties in common with type 'Feature<object, string, string>'". Import the
features of `createLayout` from `@pierre/layouts/react`.

The props of `Layout.Root` are `layout`, `renderPane`, `getPaneTitle`,
`onResize`, `onPaneClose`, `getPaneProps`, `getSeparatorProps`, `stylesheets`,
`messages`, `keymap` (see "Keyboard and motion"), `className`, `style`, and
`gap`. The layout fills its parent; give that parent a definite height.

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
  `getPaneTitle`, as an `h2` heading (`render={<h3 />}` gives another level).
  The pane's region takes its name from this heading with `aria-labelledby`; a
  pane without a title keeps an `aria-label`, and a tab panel takes the name of
  its tab. One rule gives the role and the name of a pane host from the parts
  that render in it, in any order: a host with `Layout.TabList` is a tab panel,
  also with a title beside it, else a host with `Layout.Title` is a region that
  its heading names. The parts say that they render after they mount, so a
  server render gives each host its `aria-label` only, and the tab panel role
  and the link to the heading come with hydration.
- `Layout.Content`: the area that scrolls, and the target of a collapse.
- `Layout.CollapseButton`, `Layout.CloseButton`, and `Layout.ZoomButton`.
- `Layout.MoveHandle`: the handle of `paneDrag()`, and with `arrange()` the
  trigger of the app's pane menu: a press and release with no move is a click,
  its name is "Arrange Editor" (`messages.paneMenu`), it has
  `aria-haspopup="menu"`, and it stays enabled while a pane fills the layout, so
  that "Restore" stays in reach. Without `arrange()`, it is a drag handle only,
  and a development build warns, as WCAG 2.5.7 asks for a path with no drag.
- `Layout.TabList` and `Layout.Tab`: the tabs of a stack (see "Tabs").

`Root` renders no header. The default header of the earlier `Layout` component,
with a move handle, the tabs of a stack or the title of a lone pane, and the
zoom and close buttons, is a few parts:

```tsx
const layout = createLayout(tree, [
  edits(naryTree),
  stacks(),
  zoom(),
  paneDrag(),
]);

function PaneHeader() {
  const stacked = Layout.usePane((pane) => pane.tabs.length > 1);
  return (
    <Layout.Header>
      <Layout.MoveHandle />
      {stacked ? <Layout.TabList /> : <Layout.Title />}
      <Layout.ZoomButton />
      <Layout.CloseButton />
    </Layout.Header>
  );
}

const renderPane = (pane: PaneNode) => (
  <>
    <PaneHeader />
    <Layout.Content>
      <PaneContent pane={pane} />
    </Layout.Content>
  </>
);
```

Without `arrange()`, the move handle is a drag handle only, and a development
build warns, as WCAG 2.5.7 asks for a path with no drag. Add `arrange()` and
render the items of `Layout.usePaneMenu(open)` in the app's own menu, with the
handle as its trigger, as `demo/main.tsx` and `demo/pane-menu.tsx` do.

Each part takes a `render` prop, an element or a function of the part's props
and state, so an app gives a part its own markup and keeps the part's roles,
keys, and handlers. An app's handler on a part runs before the part's own
handler for the same event. When the app's handler calls `preventDefault()`, the
part does nothing for that event: for example, an `onKeyDown` that prevents
Delete keeps a tab open, and an `onPointerDown` that prevents the default on
`Layout.Tab` or `Layout.MoveHandle` starts no drag. `Layout.usePane(select)`
reads the state of the pane of a component: its `pane` node, its `title`,
`shown`, `focused`, `zoomed`, `collapsed`, `edges`, `tabs`, and `activeTab`. The
component renders again only when the value that `select` returns changes.
`Layout.useLayout()` gives the layout object of the pane's `Root`, for its
commands, with no context of the app; it keeps its identity, so it renders its
component for no change of the layout. `Layout.useLayout<typeof layout>()` names
the type of the layout object, which the hook does not check. The consumer
guide's "Keep pane content still" gives the rules that keep pane content from
rendering at each change of the layout.

```tsx
function PaneBar() {
  const zoomed = Layout.usePane((pane) => pane.zoomed);
  const top = Layout.usePane((pane) => pane.edges.top);
  return <div data-zoomed={zoomed || undefined} data-top={top || undefined} />;
}
```

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

React puts the sheets of a layout together in `<head>`, in front of the app's
own stylesheets. A sheet that comes after the first render goes in the middle of
the stylesheets, and Chromium then updates the fonts of the whole document: each
text lays out again, and the content of a hidden pane or an inactive tab lays
out when it shows. So `stacks()` renders the sheet of `Layout.TabList` in the
first render, also before the first stack. A part that first renders later, such
as the first `Layout.Header` of a layout that starts with no header, adds its
sheet then: render the parts from the first render, or link `styles.css`.

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

Style with `--layouts-accent`, `--layouts-border`, `--layouts-pane-background`,
`--layouts-corner` (the resting color of a corner of `corners()`), and
`--layouts-duration`. The tabs take their colors from `--layouts-tab-color`,
`--layouts-tab-hover-color`, `--layouts-tab-hover-background`,
`--layouts-tab-selected-color`, `--layouts-tab-accent` (the underline of the
selected tab), and `--layouts-tab-close-hover-background`. Each property has its
default where the library uses it, and the library declares none on its own
elements, so a value on any ancestor, such as `:root`, reaches the layout, and
pane content does not inherit a value of the library.

Each name that the library puts into the page starts with the package name:
`--layouts-*` for custom properties, `pierre-layouts-*` for classes, events, and
sheets, and `data-layouts-*` for the attributes that mark its elements, such as
`data-layouts-pane`. A state attribute, such as `data-focused` or `data-hidden`,
has no prefix and describes only the element that it is on.

### Messages

`messages` holds every string of the layout: the label of the layout, the names
of controls and separators, and the announcements. Each entry is a function that
returns the whole sentence, so a translation chooses its own words and word
order. A function takes one flat object of named values, which an ICU message
catalog takes as it is:

| Key              | Where                                              | Values                                                                                                                                    | Default                                    |
| ---------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `layout`         | The name of the layout                             | (a string)                                                                                                                                | Workspace                                  |
| `remote`         | The announcement of a change from elsewhere        | `text` (what the same change from this window announces)                                                                                  | None: a remote change is silent            |
| `separator`      | The name of a separator                            | `beforeTitles`, `afterTitles` (titles joined with ", "), `beforeCount`, `afterCount`, `beforeId`, `afterId` (the first pane on each side) | Resize Files                               |
| `separatorValue` | The value text of a separator                      | `paneTitle`, `paneId` (the primary pane), `percent`                                                                                       | Files 25%                                  |
| `separatorStep`  | A step button of a separator                       | `paneTitle`, `paneId` (the primary pane), `edge`                                                                                          | Move left, Move right, Move up, Move down  |
| `collapse`       | `Layout.CollapseButton`                            | `paneTitle`, `paneId`                                                                                                                     | Collapse Editor                            |
| `close`          | `Layout.CloseButton`                               | `paneTitle`, `paneId`                                                                                                                     | Close Editor                               |
| `zoom`           | `Layout.ZoomButton`                                | `paneTitle`, `paneId`                                                                                                                     | Zoom Editor                                |
| `drag`           | `Layout.MoveHandle` without `arrange()`            | `paneTitle`, `paneId`                                                                                                                     | Drag Editor                                |
| `paneMenu`       | `Layout.MoveHandle` with `arrange()`               | `paneTitle`, `paneId`                                                                                                                     | Arrange Editor                             |
| `tabs`           | `Layout.TabList`                                   | `paneTitle`, `paneId`                                                                                                                     | Tabs of Editor                             |
| `pinned`         | The description of a pinned tab                    | (a string)                                                                                                                                | Pinned                                     |
| `zoomed`         | Announcement: a zoom                               | `paneTitle`, `paneId`                                                                                                                     | Editor zoomed                              |
| `restored`       | Announcement: the end of a zoom                    | `paneTitle`, `paneId`                                                                                                                     | Editor restored                            |
| `closed`         | Announcement: a close                              | `paneTitle`, `paneId`                                                                                                                     | Editor closed                              |
| `collapsed`      | Announcement: a collapse                           | `paneTitle`, `paneId`                                                                                                                     | Editor collapsed                           |
| `expanded`       | Announcement: an expand                            | `paneTitle`, `paneId`                                                                                                                     | Editor expanded                            |
| `hidden`         | Announcement: a hide                               | `paneTitle`, `paneId`                                                                                                                     | Editor hidden                              |
| `shown`          | Announcement: a show                               | `paneTitle`, `paneId`                                                                                                                     | Editor shown                               |
| `opened`         | Announcement: a new pane at an edge of a pane      | `paneTitle`, `paneId`, `targetTitle`, `targetId`, `edge`                                                                                  | Terminal opened to the bottom of Editor    |
| `moved`          | Announcement: a move to an edge of a pane          | `paneTitle`, `paneId`, `targetTitle`, `targetId`, `edge`                                                                                  | Editor moved to the right of Files         |
| `openedAtEdge`   | Announcement: a new pane at an edge of the layout  | `paneTitle`, `paneId`, `edge`                                                                                                             | Terminal opened in a new row at the bottom |
| `movedToEdge`    | Announcement: a move to an edge of the layout      | `paneTitle`, `paneId`, `edge`                                                                                                             | Editor moved to a new column at the left   |
| `movedToTabs`    | Announcement: a move into another stack            | `paneTitle`, `paneId`, `targetTitle`, `targetId`                                                                                          | Editor moved into the group of Files       |
| `merged`         | Announcement: a merge of the tabs of a stack       | `paneTitles` (joined with ", "), `count`, `targetTitle`, `targetId`                                                                       | Diff, Chat moved into the group of Files   |
| `resized`        | Announcement: a Grow or a Shrink                   | `paneTitle`, `paneId`, `axis`, `percent`                                                                                                  | Editor width 45%                           |
| `move`           | Status during a drag to an edge of a pane          | `paneTitle`, `paneId`, `targetTitle`, `targetId`, `edge`                                                                                  | Move Editor to the right of Files          |
| `moveInto`       | Status during a tab drag into a stack              | `paneTitle`, `paneId`, `targetTitle`, `targetId`                                                                                          | Move Editor into the group of Files        |
| `moveBeside`     | Pane menu item: beside the pane across an edge     | `paneTitle`, `paneId`, `targetTitle`, `targetId`, `edge`                                                                                  | Move left of Files, Move above Files       |
| `moveToEdge`     | Pane menu item: an edge of the layout              | `paneTitle`, `paneId`, `edge`                                                                                                             | Move to a new column at the left           |
| `moveToTabs`     | Pane menu item: into the tabs of a pane            | `paneTitle`, `paneId`, `targetTitle`, `targetId`                                                                                          | Move to the tabs of Files                  |
| `mergeInto`      | Pane menu item: merge the tabs into a pane         | `paneTitle`, `paneId`, `targetTitle`, `targetId`                                                                                          | Merge tabs into Files                      |
| `moveToMenu`     | Pane menu item that holds a place beside each pane | `paneTitle`, `paneId`                                                                                                                     | Move to…                                   |
| `place`          | An item of "Move to…"                              | `paneTitle`, `paneId`, `targetTitle`, `targetId`, `edge` (an edge or `tabs`)                                                              | Left of Files, Above Files, Tabs of Files  |
| `resize`         | Pane menu items: Grow and Shrink                   | `paneTitle`, `paneId`, `axis`, `grow`                                                                                                     | Wider, Narrower, Taller, Shorter           |
| `maximize`       | Pane menu item of `zoom()`                         | `paneTitle`, `paneId`, `zoomed`                                                                                                           | Maximize, or Restore while zoomed          |

The titles come from `getPaneTitle`, and the IDs are the `PaneNode.id` strings
of the tree, so a translation in a language that inflects names can find the
form of a name that its sentence needs. Announcements name panes by their
titles. `Root` announces the changes of its own window. A change that
`applyOperations` applies from elsewhere, such as an agent's move, speaks only
with `messages.remote`, which gets the text that the same change from this
window announces: ``remote: ({ text }) => `Agent: ${text}` ``. The live region
has no other text, so a change that announces nothing leaves it as it is.

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
ends, each covered pane host gets `data-covered="zoom"` and
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
saved form keeps it. A hidden pane host has `data-hidden="true"`. `onPaneClose`
of `Root` replaces the close of `Layout.CloseButton`, for example to hide the
pane:

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
cheap. A pane that the layout gets during a zoom is covered as the other panes
are: it leaves the accessibility tree and the tab order at once, and its content
stops rendering, with the event, when the animation of the zoom ends.

```tsx
import {
  PANE_VISIBILITY_EVENT,
  type PaneVisibilityEvent,
} from '@pierre/layouts/react';

useEffect(() => {
  const host = ref.current?.closest('[data-layouts-pane]');
  if (host == null) return;
  const onVisibility = (event: Event) => {
    setPaused((event as PaneVisibilityEvent).detail.hidden);
  };
  host.addEventListener(PANE_VISIBILITY_EVENT, onVisibility);
  return () => host.removeEventListener(PANE_VISIBILITY_EVENT, onVisibility);
}, []);
```

### What hidden content does

The `hiddenContent()` feature chooses what the content of a pane does while its
pane does not show: a hidden pane, an inactive tab, a pane under a zoom or an
overlay, or a pane that collapses. Without it, the content stays mounted. The
modes go from the most live to the least:

| Mode                | While the pane does not show                                           | When it shows again            |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| `mounted` (default) | Mounted and running; style, layout, and paint skipped                  | Shows at once, with its state  |
| `activity`          | In a hidden React `<Activity>`: state and DOM kept, effects cleaned up | Its effects run again          |
| `unmount`           | Unmounted; a pane that does not show at its first render never mounts  | Mounts again, with a new state |

`hiddenContent('activity')` gives every pane one mode. A function chooses for
each pane from its node, for example by the kind of its content: a terminal that
must keep running stays `mounted`, a preview that can pause waits in `activity`,
and a heavy view that is cheap to build again unmounts.

```ts
const layout = createLayout(root, [
  edits(naryTree),
  stacks(),
  hiddenContent((pane) =>
    kindOf(pane) === 'terminal'
      ? 'mounted'
      : kindOf(pane) === 'graph'
        ? 'unmount'
        : 'activity'
  ),
]);
```

When a pane collapses to its header, the header stays, and the children of
`Layout.Content` follow the mode. Content reads its mode with
`Layout.usePane((pane) => pane.hiddenContent)`. In each mode the host stays,
with its visibility attributes and its tab, and the content receives
`PANE_VISIBILITY_EVENT` with `hidden: true` before it waits or unmounts. In
`activity`, its effects then clean up, and they run again when it shows, in
place of the event of the show. The package needs React 19.2 or later, for
`<Activity>`. Do not return `null` from `renderPane` for an inactive tab: choose
a mode, so that the layout knows when the tab shows.

The mode is a fixed property of a kind of content: give a pane the same mode for
as long as it is in the layout. The mode is not a level that changes with time,
such as "unmount after ten minutes hidden": a function that gives a pane another
mode later can mount its content again, with a new state, because the boundary
of the mode changes.

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
layout.mergeStack('logs'); // Every tab of its stack into the pane before it.
```

`mergeStack(id, targetId?)` moves every tab of the stack of a pane into the
stack of a target, after its tabs and in their order, in one change: one
`moveToStack` operation for each tab, which a server folds as it folds any
other. The target is the pane before the stack in `visualOrder`, or the pane
after it when none comes before it. A pinned tab stays. The target keeps its
active tab, except when the merged stack had the focus: then the tab that showed
shows, with the focus. The change speaks once: "Diff, Chat moved into the group
of Files" (`messages.merged`).

`Layout.TabList` renders the tabs of the stack of its pane, with the WAI-ARIA
tabs pattern, and makes the pane host the tab panel of its tab. A pane outside a
stack shows its own tab. Left and Right arrows move to the previous or the next
tab, Home and End to the first or the last, and the tab with the focus shows.
With `activation="manual"`, these keys move the focus only, and Enter or Space
shows the focused tab: use it when a tab's content takes the focus when it
shows, such as a terminal, or when it is slow to show. Delete closes the focused
tab. Ctrl+Shift+PageUp and Ctrl+Shift+PageDown move the focused tab before the
previous tab or after the next one, as Firefox, Chrome, and VS Code move their
tabs; on a Mac keyboard without these keys, add Fn to the Up and Down arrows.
With `tabDrag()`, a pointer drag moves a tab in its tab list, into another
stack, or beside a pane, and a marker shows where it goes; Escape cancels the
drag. A touch drag of a tab starts after a still press of 250 ms
(`tabDrag({ touchDelay })` changes it), so a swipe on a tab list scrolls it; a
mouse or a pen starts a drag after a move of 4 pixels. During a drag, a copy of
the tab follows the pointer, beside it, and the source dims; the marker shows
the place, and the other tabs do not move. `tabDrag({ preview })` renders the
app's element in place of the copy, and `tabDrag({ preview: false })` shows no
image, so a move that keeps its place draws no frame. A split or a move beside a
pane of a stack goes beside the whole stack. A close or a hide of the active tab
shows the nearest tab. A stack of one pane gives way to that pane. A zoom of a
tab zooms its stack, and a change of tab keeps the zoom.

A layout has one rule for places (`DEC-layouts-one-place-rule`):
`canPlace(source, place, state)` in `createLayout`. `source` is the pane that
goes to the place: a pane of the tree that moves, or a new pane that opens.
`place` is a `Place`, and `state` holds the tree before the change. The drags,
the items of `Layout.usePaneMenu()`, `moveTo`, `openAt`, and the commands
`split`, `move`, `addTab`, and `moveToStack` all read it. A drag target that it
refuses shows no marker and no preview, and takes no drop; the drag goes on, and
it asks once for each target under the pointer, after the pinned rule. The menu
does not offer a refused place. `moveTo` and `openAt` return `false` and change
nothing. A command throws `LayoutOperationError` with the code `place_refused`.
A change of the order of the tabs of one stack is not a place. For example, at
most 8 groups, where a group is a pane or a stack outside a stack:

```ts
const canPlace: CanPlace = (source, place, state) =>
  !('beside' in place) ||
  isAlone(state.root, source.id) ||
  groupCount(state.root) < 8;

const layout = createLayout(root, [edits(naryTree), stacks(), tabDrag()], {
  canPlace,
});
```

Give a server the same rule:
`applyLayoutOperations(root, operations, { canPlace })` refuses the same places
with `place_refused`.

`Layout.Tab` takes a `render` prop for the app's own tab. Mark a close control
inside a tab with `data-layouts-tab-close`, so that a press on it does not start
a drag; the class `pierre-layouts-tab-close` gives it the close mark's style.

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

`<Layout.TabList stickyPinned />` keeps the pinned tabs in view while the other
tabs scroll, as browsers and editors keep pinned tabs. Each pinned tab sticks at
its own place, and a tab that takes the focus scrolls into view beside the
pinned tabs. The list holds the width of the pinned tabs in
`--layouts-pinned-width`, for the app's fade. The option turns itself off while
less than 120 px of the list is left for the other tabs. It is off by default.
The tab list must be the element that scrolls, as in `Layout.Header`, and each
pinned tab a child of the list, as `Layout.Tab` and its `render` element are.

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
  gets `data-covered="overlay"`, `content-visibility: hidden`, and `inert`, and
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

The target of `split` and `move` is a pane, a stack, or a split. A pane of a
stack puts the pane beside the stack. A split of the direction of the edge takes
the pane as its first or last child, with the mean weight of its children, and a
split across it is wrapped:
`layout.move('chat', layout.getSnapshot().root.id, 'left')` gives the chat a new
column at the left of the layout. A target that a move takes apart gives its
place to what remains of it. The announcement says "Chat moved to a new column
at the left" (`messages.movedToEdge` and `messages.openedAtEdge`).

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

### Spatial queries

`visualOrder(root)` gives the panes that show, in the order of the tree: depth
first, the children of a row from left to right and of a column from top to
bottom, so a column finishes before the next one starts. A stack gives the tab
that shows; `visualOrder(root, { tabs: true })` gives each tab that is not
hidden. `neighbors(root, id, edge)` gives the panes that show and touch one edge
of a pane, and `neighbor(root, id, edge, recent)` picks one of them: the panes
whose span across the axis overlaps the pane, then the first of `recent` (the
most recently focused pane IDs, most recent first), else the first in tree
order. At an edge of the layout, it gives null. Both read the tree only, with no
pixel size, so a server and a test can call them; a child with a size in pixels
counts as the mean weight of its split. A `Place` says where a pane goes:
`{ beside, edge }`, beside a pane, a stack, or a split (the root for an edge of
the layout), or `{ into, index }`, into the tabs of the stack of a pane.
`moveTo(layout, id, place)` moves a pane to a place, with `move` of `edits()` or
`moveToStack` of `stacks()`, and `openAt(layout, pane, place)` opens a new pane
there, with `split` or `addTab`. Each throws an error that names the feature
when the layout does not have it. The pane menu, the keys, and a drop give a
place, so they share these two functions and their announcements.

### Stores without a view

`createLayoutStore(root, features)` from `@pierre/layouts` creates a store
without the view, for a server, a test, or another view. Without features, the
store has the core commands only: `getSnapshot`, `subscribe`, `setRoot`,
`setSizes`, `setCollapsed`, `focusPane`, `transient`, and `revert`, and it keeps
the shape of each tree that it receives. Each store feature adds its commands:

| Feature         | Commands                                                        |
| --------------- | --------------------------------------------------------------- |
| `edits(model)`  | `split`, `close`, `move`, `swap`; the store gets the tree model |
| `stacks()`      | `activate`, `addTab`, `moveToStack`, `moveTab`, `setPinned`     |
| `zoom()`        | `toggleZoom`, `setZoom`                                         |
| `hiddenPanes()` | `setHidden`                                                     |
| `persistence()` | `toStoredTree`, `setStoredTree`                                 |

```ts
import { createLayoutStore, edits, naryTree, stacks } from '@pierre/layouts';

const store = createLayoutStore(root, [edits(naryTree), stacks()]);
```

The two entries give each feature the same name and the same call: in
`@pierre/layouts` it returns a `StoreFeature` for `createLayoutStore`, and in
`@pierre/layouts/react` a feature for `createLayout`, with its view. A bundler
keeps only the features that an app imports, so a store with no tree edits loads
no tree model. A move of a tab into another stack takes the pane out of its
place with the tree model, so it needs `edits`.

Read with `layout.getSnapshot()`. Snapshots are immutable. Invalid tree updates
throw before changing state. A close or a hide of the last pane that is not
hidden throws `last_pane`: `canClose(root, id)` gives the rule. Closing a
focused or zoomed pane repairs the selection. `getPanes(root)` lists the panes
of a tree in the order of the tree, hidden panes and the tabs of each stack
included, and `stackOf(root, id)` gives the stack of a pane, or null.
Persistence is caller-owned; the playground uses local storage.

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
  `id_in_use`, `pane_pinned`, `place_refused` (the `canPlace` option, the rule
  of the layout), or `unknown_operation`.
- Undo keeps the settled states: a listener that skips transient and remote
  changes pushes the state before each local change, and an undo sets that tree
  again with `setRoot`.

`computeLayout(root, width, height, gap)` returns pane rectangles and separators
for other rendering adapters, and `pixelCorners(geometry, gap)` adds the corner
intersections. Corners are a separate pass, so an adapter without corners does
not compute them. Pane minimums default to 120 × 80 pixels.
`getMinimumSize(root, gap)` and `getMaximumSize(root, gap)` give the smallest
and the largest size of a tree or a subtree with the same rules: the minimums of
the panes, the collapsed size of a collapsed child, the gaps, and no space for
hidden panes; a size with no limit is `Infinity`. An app reads them, for
example, for the minimum width of the panel that holds a layout. When minimums
cannot fit, the engine shares the shortage proportionally without creating
negative dimensions or overflow. Preferred sizes survive temporary viewport
constraints.

## Keyboard and motion

F6 moves the focus to the next pane that can take it, in `visualOrder`, and
Shift+F6 to the previous one. A pane that does not show, a pane collapsed to 0
pixels (alone or with its stack), and a pane that an overlay covers
(`coverLayout`) take no focus; a pane collapsed to its header takes it. The
store owns this rule, so F6, `layout.focusNext()`, and `layout.focusPane(id)`
follow it: a call that names a pane that cannot take the focus changes nothing,
and when the focused pane collapses to 0 pixels, the focus goes to the first
pane that can take it. The pane gets the element that had the focus in it last,
else its `Layout.Content`, which is focusable from script so that the arrow keys
scroll it, else its host. `Root` takes F6 in the capture phase, before pane
content, so a terminal or an editor that takes every other key, Tab and Escape
too, still has an exit. With one pane that can take the focus, or while a pane
fills the layout, F6 goes on to the content and the browser. At the last pane,
F6 sends a cancelable `FOCUS_EDGE_EVENT` (`pierre-layouts-focus-edge`, with
`detail.direction` `next` or `previous`) to the layout element before it wraps
to the first pane: an app with other regions, such as a sidebar, cancels it and
moves the focus there. No pane host is a tab stop: Tab moves through the chrome
and the content of the panes. A read-only pane that scrolls gives its
`Layout.Content` `tabIndex={0}`. An app moves the focus with
`layout.focusNext()`, `layout.focusPrevious()`, or
`layout.focusPane(id, { reveal: true })`, which move the DOM focus too.

The keys of the layout run named commands. `defaultKeys` lists them with their
default keys: `focus.next` (F6) and `focus.previous` (Shift+F6), and with
`zoom()`, `zoom.restore` (Escape) and `zoom.toggle` (no key). Only these keys
have defaults, as every other cross-platform key conflicts with a screen reader,
text editing, or the browser. `Root`'s `keymap` prop changes the keys of a
command by its ID: a list replaces the defaults, and `null` removes them, for
example
`keymap={{ 'focus.next': ['Alt+Shift+ArrowRight'], 'focus.previous': null, 'zoom.toggle': ['Mod+Shift+Z'] }}`.
A key string is modifiers and a key joined with `+`: `Ctrl`, `Alt`, `Shift`,
`Meta`, and `Mod` (Meta on Apple platforms, Ctrl elsewhere), then a
`KeyboardEvent.key` value; a letter or a digit compares by its key code. A
command runs on a key that pane content did not handle with `preventDefault()`,
outside a text field and outside a composition; only `focus.next` and
`focus.previous` run before pane content. An app whose content needs F6 moves
these two commands to other keys. In development, `Root` warns about a keymap ID
that no command of the layout has. The keys of a separator and of a tab list
belong to their widgets, and the keymap does not change them.

`arrange()` moves and resizes panes with no drag. `layout.focusToward(edge)`
moves the focus to the pane across an edge of the focused pane (`neighbor`, with
the panes that had the focus last). `layout.grow(id, axis)` and
`layout.shrink(id, axis)` change a pane by 10% of the nearest split of that axis
(`horizontal` for the width) that holds it, as Shift with an arrow key on its
separator does, and report it through `onResize`; they speak "Editor width 45%"
(`messages.resized`). Their key commands have no default keys: `focus.left`,
`focus.right`, `focus.up`, `focus.down`, `pane.wider`, `pane.narrower`,
`pane.taller`, `pane.shorter`, and `pane.menu`, which opens the pane menu of the
focused pane from its move handle.

`Layout.usePaneMenu(open)`, in a component of a pane, gives the items of the
pane menu for the app's own menu component, whose trigger is
`Layout.MoveHandle`; the library ships no menu component. Each item has an `id`,
a `group` (`move`, `size`, or `zoom`), a `label`, `disabled`, and `run()`; a
move item has its `place`, and "Move to…" has its `items`. The move items list
each place that changes the layout once: beside the pane across each edge ("Move
left of Files"), at each edge of the layout ("Move to a new column at the
left"), with `stacks()` into the tabs of each neighbor and "Merge tabs into
Files" for a pane of a stack, and in "Move to…" a place beside each other pane
and its tabs. Then "Wider", "Narrower", "Taller", and "Shorter", disabled at a
limit, and with `zoom()` "Maximize" or "Restore". While a pane fills the layout,
the move and size items are disabled and "Restore" stays. The labels come from
`messages` (`moveBeside`, `moveToEdge`, `moveToTabs`, `mergeInto`, `moveToMenu`,
`place`, `resize`, and `maximize`). The items exist while `open` is true: they
read the layout's boxes for the limits and change with the layout. With `open`
false, the hook gives an empty list, reads nothing, and does not render its
component when the layout changes, so the header that holds the trigger can call
it with the state of its menu: `const items = Layout.usePaneMenu(menuOpen)`.
`demo/pane-menu.tsx` is a reference menu on the hook, with the WAI-ARIA menu
button pattern.

A drag of a separator changes the two children of its split beside it. When one
of them reaches its minimum size, the next child on that side gives the space,
and so on. `onResize` reports the sizes after the release. No API changes the
sizes during a drag: the resize session of the earlier `Layout` component
(`onResizeStart`, whose session snapped or limited the sizes at each move) is
gone, so an app cannot snap a panel to a grid or to fixed steps while the
pointer moves. Snap points on a separator are a planned exploration, and a
constraint option comes when an app needs one. Resize separators with arrow
keys; hold Shift for larger steps. Home and End move a separator until the child
before or after it has its minimum size. As in the window splitter pattern, the
primary pane of a separator is the pane or the stack before it: the separator's
name and value text come from its title, `aria-controls` names it, and Enter
collapses it or expands it again. At the focus, and after each change while it
has the focus, `aria-valuenow`, `aria-valuemin`, and `aria-valuemax` give the
real place and limits in percent of the split: the limits are the places where
the panes on each side have their minimum sizes. A separator's pointer target is
at least 24 px across, with no change to the visible gap, and a focused
separator keeps its focus visible in forced colors mode. A press and release on
a separator with no move shows two step buttons across it, "Move left" and "Move
right" (or up and down; `messages.separatorStep`), each a step of 10% of the
split, as Shift with an arrow key: the path with no drag that WCAG 2.5.7 asks
for, also in a layout with no feature. They stay for the next step, and a press
elsewhere or Escape hides them. A corner of `corners()` is a pointer shortcut
only: it has a 24 px target, takes no focus, and is hidden from assistive
technology, because the keyboard resizes each of its two separators. Each
control in `Layout.Header` is a pointer target of at least 24 px, and the header
is 40 px high, so the target of a separator above the pane does not cover a
control. The close mark of a tab (`pierre-layouts-tab-close`) has a target of 24
px. Escape cancels an active gesture, and restores a zoomed layout with
`zoom()`, unless pane content handled it with `preventDefault()`. Hidden panes
remain mounted but are inert and excluded from the accessibility tree. Motion
respects `prefers-reduced-motion`.

Each pane host clips its content at its rounded border with `overflow: clip`.
From 6 visible panes, each pane host is its own compositor layer
(`transform: translateZ(0)`): an update in one pane then costs Blink less
compositing work. With fewer panes, the layers cost tile memory and save no
measured time. Keep `--layouts-pane-background` opaque, so that text in a layer
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
