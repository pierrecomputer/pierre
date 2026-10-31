# @pierre/layouts

Experimental split-pane layouts for complex applications. A
framework-independent tree and geometry engine with a React view. The package is
private while its API is being developed.

The first version supports nested horizontal and vertical splits, constrained
resizing, two-axis corner resizing, dragging panes beside other panes, animated
zoom/restore, keyboard resizing, and saving layout state. Flat keyed pane hosts
preserve React state, uncontrolled inputs, and scroll positions during
rearrangement and zooming. Pane hosts keep a stable DOM order by ID, while the
split tree determines visual placement. Closing a pane unmounts its content.

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
keyboard-accessible controls to split, move, save, and restore panes.

## React

```tsx
import { LayoutStore, type PaneNode } from '@pierre/layouts';
import { Layout } from '@pierre/layouts/react';
import '@pierre/layouts/styles.css';

// Create once, outside the render function or with a lazy useState initializer.
const store = new LayoutStore({
  type: 'split',
  id: 'workspace',
  direction: 'horizontal',
  sizes: [0.25, 0.75],
  children: [
    { type: 'pane', id: 'files', minWidth: 160 },
    { type: 'pane', id: 'editor', minWidth: 320 },
  ],
});

// A stable function: each pane's content renders again only when this
// function or the pane's node changes.
const renderPane = (pane: PaneNode) => <div>{pane.id}</div>;

export function Workspace() {
  return (
    <div style={{ height: 600 }}>
      <Layout
        store={store}
        renderPane={renderPane}
        getPaneTitle={(pane) => pane.id}
      />
    </div>
  );
}
```

A focus change, a zoom, and a resize do not render pane content again: the store
keeps the identity of each node that a change does not touch, and the view
renders a pane's content only when its node or `renderPane` changes. Pass a
stable `renderPane`, for example a module function or one from `useCallback`.
`store.setRoot(root)` keeps each node of the store's own tree that the new tree
reuses, so an app can show or hide panes by building a new tree from the nodes
of `store.getSnapshot().root`, and the panes that stay keep their content.

Changes of the split tree (split, close, move, hide, and show) and zoom changes
animate by default. `animate={{ layout: false }}` applies tree changes at once,
and `animate={{ zoom: false }}` applies zoom and restore at once. A user's
`prefers-reduced-motion: reduce` turns both off.

Each pane header has a drag grip, a zoom button, and a close button.
`paneActions` selects them for all panes, for example `['zoom', 'close']`, or
for each pane with a function of the pane node. By default the close button
calls `store.close`; `onPaneClose` replaces it, for example to hide the pane.

`store.setHidden(id, true)` hides a pane: it keeps its place in the tree, its
content, its state, and its scroll position, but takes no space, and its sibling
takes its box. `store.setHidden(id, false)` shows it again in its place, also
after other panes moved, and focuses it. The last visible pane stays visible.
The hidden flag is part of the pane node, so `serialize()` keeps it. A hidden
pane host has `data-collapsed="true"` and receives `PANE_VISIBILITY_EVENT` when
it hides or shows.

```tsx
<Layout
  store={store}
  renderPane={renderPane}
  paneActions={(pane) =>
    pane.id === 'sidebar' ? [] : ['move', 'zoom', 'close']
  }
  onPaneClose={(pane) => store.setHidden(pane.id, true)}
/>
```

The layout fills its parent; give that parent a definite height. Pane IDs and
split IDs share one namespace and must be unique, non-empty strings. Horizontal
splits arrange their children left to right; vertical splits arrange them top to
bottom. A split has two or more children, and `sizes` holds one positive weight
for each child. The visible children share the space of the split, without its
separators, in proportion to their weights. A child whose share is below its
minimum size gets its minimum, and the others share the rest.

The React view generates CSS container-unit expressions from the split tree. The
browser resolves panel bounds, gaps, and minimum-size constraints during
container resizing, without JavaScript measurements or React size updates. Each
edge of each box is a piecewise-linear function of the container size, so each
pane host, separator, and corner gets one short value for each property, such as
`calc(-6px + 0.25 * 100cqw)`, with one `max(0px, 100cqw - 216px)` term for each
size at which a minimum size or a gap starts to apply. The values use no custom
properties, so a size change restyles only the elements that move, not the pane
content inside them. Pane hosts stay flat and stable so moving a pane preserves
its content. JavaScript computes pixel geometry only for pointer/keyboard
interactions and zoom exit directions. A ResizeObserver finishes an in-progress
discrete animation when the container changes size; it does not calculate panel
bounds. `computeCSSLayout(root, gap)` exposes these expressions for other CSS
adapters. This requires browser support for container query units and CSS size
containment.

## Hidden panes

While a pane is zoomed, the other panes stay mounted. When the zoom animation
ends, each covered pane host gets `data-hidden="true"` and
`content-visibility: hidden`, so the browser skips the style, layout, and paint
of its content. The content keeps its DOM, its React state, and its scroll
position. The zoom moves the focus into the zoomed pane first. On restore, the
view shows the panes again before the restore animation starts.

Each pane host has `contain: style`, so a hide changes no style containment. In
Chromium, such a change updates the style of the whole document. Style
containment scopes CSS counters and quotes to the pane: a counter that pane
content increments starts again in each pane.

Scripts in a hidden pane keep running. The pane host receives a
`PANE_VISIBILITY_EVENT` event when its content stops and starts rendering, so
that content such as a terminal or a chat can pause its own work. The event does
not bubble. A pane that mounts during a zoom is not hidden. The view sets
`data-hidden` itself, so a zoom does not render the pane hosts again.

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

## Model and state

```ts
store.split('editor', { type: 'pane', id: 'terminal' }, 'bottom');
store.move('terminal', 'files', 'right');
store.focusPane('editor');
store.toggleZoom();
store.close('terminal');
store.setSizes({ workspace: [0.3, 0.7] });

const saved = store.serialize();
store.restore(saved);
```

The saved form has version 2. `restore` also accepts version 1, where each split
had `ratio`, `first`, and `second`; `fromBinaryLayout` converts such a tree.

### Tree models

The tree model of the store sets the shape of the tree and how a split and a
close change it. The geometry, the drag rules, and the view are the same for
each model.

- `binaryTree` (the default): each split has two children, and a split can hold
  a split of the same direction. A split of a pane always puts a new split in
  its place, and a close gives the space of the split to the sibling. A row of
  three panes is a row in a row, so a drag of a separator also resizes every
  pane of the subtree on the other side, and two rows that look the same can
  behave differently.
- `naryTree`: no split holds a split of the same direction, so each visual row
  or column is one node. A split of a pane to its left or right, in a row, adds
  the new pane to the row with half of the pane's size. A close gives the size
  of a pane to the nearest visible child before it, or after it when there is
  none. A drag of a separator changes only the panes beside it until one of them
  reaches its minimum size.

```ts
import { binaryTree, LayoutStore, naryTree } from '@pierre/layouts';

const store = new LayoutStore(root, { model: naryTree });
store.setModel(binaryTree); // Gives the tree the shape of the binary model.
```

The store gives each tree that it receives the shape of its model: the n-ary
model joins a split into a parent of the same direction, and the binary model
nests the children after the first in new splits. A pane keeps its node, so its
content does not render again.

Subscribe with `store.subscribe(listener)` and read with `store.getSnapshot()`.
Snapshots are immutable. Invalid tree updates throw before changing state.
Closing the final pane does nothing; closing a focused or zoomed pane repairs
the selection. Serialization stores layout geometry and selection, not pane
content. Persistence is caller-owned; the playground uses local storage.

`computeLayout(root, width, height, gap)` returns pane rectangles, separators,
and corner intersections for other rendering adapters. Pane minimums default to
120 × 80 pixels. When minimums cannot fit, the engine shares the shortage
proportionally without creating negative dimensions or overflow. Preferred sizes
survive temporary viewport constraints.

A drag of a separator changes the two children of its split beside it. When one
of them reaches its minimum size, the next child on that side gives the space,
and so on. Resize separators with arrow keys; hold Shift for larger steps. Home
and End move a separator until the child before or after it has its minimum
size; Enter gives the two children beside it the same size. Corner controls
accept arrows on both axes. Escape cancels an active gesture or restores a
zoomed layout. Hidden panes remain mounted but are inert and excluded from the
accessibility tree. Motion respects `prefers-reduced-motion`.

Each pane host clips its content at its rounded border with `overflow: clip`.
From 6 visible panes, each pane host is its own compositor layer
(`transform: translateZ(0)`): an update in one pane then costs Blink less
compositing work. With fewer panes, the layers cost tile memory and save no
measured time. `paneLayers` changes this: `true` and `false` turn the layers on
and off for every pane count, and `{ minPanes: n }` turns them on from `n`
visible panes. Keep `--layout-pane-background` opaque, so that text in a layer
keeps subpixel antialiasing. The host never scrolls; its content area scrolls.
Put a menu or a tooltip that must extend past its pane in the top layer, with
`popover` or `<dialog>`. The header and the content sit in a wrapper with an
identity transform, so `position: fixed` in pane content is fixed to the pane.
While a pane changes size, the wrapper takes the inverse of the pane's scale, so
text and headers keep their shape and the pane's frame reveals or clips its
content.

Style with `--layout-accent`, `--layout-border`, `--layout-pane-background`, and
`--layout-duration`. Discrete layout changes animate with transforms from each
element's old box (FLIP), so the compositor runs them and pane content lays out
once; continuous container resizing has no easing. This is an initial web
implementation, not a claim of matching native CoreAnimation's per-frame
performance. Cross-window dragging, overlay sidebars, tab groups, and docking
are future work.

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
