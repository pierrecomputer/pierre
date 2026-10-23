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
  ratio: 0.25,
  first: { type: 'pane', id: 'files', minWidth: 160 },
  second: { type: 'pane', id: 'editor', minWidth: 320 },
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

The layout fills its parent; give that parent a definite height. Pane IDs and
split IDs share one namespace and must be unique, non-empty strings. Horizontal
splits arrange children left/right; vertical splits arrange them top/bottom.
Ratios describe the first child's preferred share of space, excluding the gap.

The React view generates CSS container-unit expressions from the split tree. The
browser resolves panel bounds, gaps, and minimum-size constraints during
container resizing, without JavaScript measurements or React size updates. Each
edge of each box is a piecewise-linear function of the container size, so each
pane host, separator, and corner gets one short value for each property, such as
`calc(-6px + 0.25 * 100cqw)`, with one `max(0px, 100cqw - 216px)` term for each
size at which a minimum size or a gap starts to apply. The values use no custom
properties, so a ratio change restyles only the elements that move, not the pane
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
store.setRatios({ workspace: 0.3 });

const saved = store.serialize();
store.restore(saved);
```

Subscribe with `store.subscribe(listener)` and read with `store.getSnapshot()`.
Snapshots are immutable. Invalid tree updates throw before changing state.
Closing the final pane does nothing; closing a focused or zoomed pane repairs
the selection. Serialization stores layout geometry and selection, not pane
content. Persistence is caller-owned; the playground uses local storage.

`computeLayout(root, width, height, gap)` returns pane rectangles, separators,
and corner intersections for other rendering adapters. Pane minimums default to
120 × 80 pixels. When minimums cannot fit, the engine shares the shortage
proportionally without creating negative dimensions or overflow. Preferred
ratios survive temporary viewport constraints.

Resize separators with arrow keys; hold Shift for larger steps. Home/End reach
the available limits; Enter balances the split. Corner controls accept arrows on
both axes. Escape cancels an active gesture or restores a zoomed layout. Hidden
panes remain mounted but are inert and excluded from the accessibility tree.
Motion respects `prefers-reduced-motion`.

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
