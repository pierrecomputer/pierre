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
numbered mosaic and a repo-explorer arrangement, editable notes and counters,
and keyboard-accessible controls to split, move, save, and restore panes.

## React

```tsx
import { LayoutStore } from '@pierre/layouts';
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

export function Workspace() {
  return (
    <div style={{ height: 600 }}>
      <Layout
        store={store}
        renderPane={(pane) => <div>{pane.id}</div>}
        getPaneTitle={(pane) => pane.id}
      />
    </div>
  );
}
```

The layout fills its parent; give that parent a definite height. Pane IDs and
split IDs share one namespace and must be unique, non-empty strings. Horizontal
splits arrange children left/right; vertical splits arrange them top/bottom.
Ratios describe the first child's preferred share of space, excluding the gap.

The React view generates CSS container-unit expressions from the split tree. The
browser resolves panel bounds, gaps, and minimum-size constraints during
container resizing, without JavaScript measurements or React size updates. Pane
hosts stay flat and stable so moving a pane preserves its content. JavaScript
computes pixel geometry only for pointer/keyboard interactions and zoom exit
directions. A ResizeObserver cancels an in-progress discrete animation when the
container changes size; it does not calculate panel bounds.
`computeCSSLayout(root, gap)` exposes these expressions for other CSS adapters.
This requires browser support for container query units and CSS size
containment.

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
`--layout-duration`. CSS transitions animate discrete layout changes; continuous
container resizing has no easing. This is an initial web implementation, not a
claim of matching native CoreAnimation's per-frame performance. Cross-window
dragging, overlay sidebars, tab groups, and docking are future work.

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
