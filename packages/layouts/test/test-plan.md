# Layout test plan

This plan lists the behavior that `@pierre/layouts` must keep, and how each item
is checked. Use it to verify an iteration: run the automated checks, then do the
manual steps for the items that have no automated check. Add an item when a
feature is added, and give it an automated check when one is possible.

Checks:

- `unit`: `moon run layouts:test` (Bun, `test/*.test.ts`).
- `e2e`: `moon run layouts:test-e2e` (Playwright, `test/e2e/*.pw.ts`).
- `bench`: `moon run layouts:bench`; the ID is a check in `bench/lib/checks.ts`.
- `manual`: the steps in the item.

The status column records the result for the revision in the heading.

## Status for the prototype at `4808853d`

### Behavior

| ID  | Behavior                                                                                                                                 | Check                                  | Status  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------- |
| B1  | Split a pane to each of the four edges. The new pane takes half of the target's space.                                                   | `unit`                                 | pass    |
| B2  | Close a pane. Its sibling takes its space, and focus moves to a remaining pane.                                                          | `unit`, `e2e` pointer rearrangement    | pass    |
| B3  | Drag a pane by its grip to each edge of another pane. A drop indicator shows the result before the drop.                                 | `e2e` pointer rearrangement (one edge) | partial |
| B4  | Move a pane with the keyboard only, with no pointer.                                                                                     | none; the library has no keyboard move | fail    |
| B5  | Drag a separator. Each pane keeps its minimum size.                                                                                      | `e2e` pointer resizing                 | pass    |
| B6  | Resize with the keyboard on a focused separator: arrows, Shift with arrows, Home, End, Enter.                                            | `e2e` keyboard limits                  | pass    |
| B7  | Drag a corner where two separators meet. Both axes change.                                                                               | `e2e` corner dragging                  | pass    |
| B8  | Zoom a pane to fill the layout, and restore it with its button or with Escape.                                                           | `e2e` zoom and rearrangement           | pass    |
| B9  | Content keeps its state through move, zoom, split, and close of another pane: input values, component state, scroll position, and focus. | `e2e` zoom and rearrangement           | pass    |
| B10 | A change of container size keeps the preferred ratios and the minimum sizes, with no script.                                             | `e2e` container resizing               | pass    |
| B11 | Save the layout and restore it. The split tree is the same.                                                                              | `unit`, `e2e` saving and reloading     | pass    |
| B12 | Restore rejects malformed saved state.                                                                                                   | `unit`                                 | pass    |
| B13 | Escape or a pointer cancel during a drag restores the state before the drag.                                                             | `e2e` Escape cancellation              | pass    |
| B14 | A pane can keep a fixed size in pixels when the container changes size, for example a 240 px file tree.                                  | none; the model has ratios only        | fail    |
| B15 | Overlays: a modal overlay and a slide-in menu open over the workspace and close back to the element that opened them.                    | none; not built                        | n/a     |

### Accessibility

| ID  | Requirement                                                                                         | Check                                        | Status   |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------- |
| A1  | Every control works with the keyboard: grips, zoom, close, separators, and corners.                 | `e2e` (separators only); manual for the rest | partial  |
| A2  | Each separator is a focusable `separator` with a name, an orientation, and a value.                 | `e2e` keyboard limits; manual screen reader  | pass     |
| A3  | Each pane is a named region.                                                                        | manual                                       | pass     |
| A4  | A key moves focus from pane to pane, for example F6, in visual order.                               | none                                         | fail     |
| A5  | The Tab order follows the visual order after panes move.                                            | manual: move pane 1 below pane 3, then Tab   | fail     |
| A6  | A pointer target for a separator is at least 24 by 24 CSS pixels, or meets the spacing exception.   | manual: measure `.pierre-layout-separator`   | fail     |
| A7  | A keyboard or single-pointer alternative exists for every drag: move and corner resize.             | none                                         | fail     |
| A8  | The zoom button exposes its state with `aria-pressed`, and its name does not change with the state. | manual                                       | fail     |
| A9  | Covered panes are `inert` while a pane is zoomed, and focus returns to the restored pane.           | `e2e` zoom and rearrangement                 | pass     |
| A10 | A visible focus indicator shows on every control, also in forced colors mode.                       | manual: forced colors emulation in DevTools  | fail     |
| A11 | Layout changes are announced in a polite live region.                                               | manual                                       | partial  |
| A12 | With reduced motion, the layout does not animate.                                                   | `e2e` (all tests run with reduced motion)    | pass     |
| A13 | No axe-core violations in the default state, the zoomed state, and during a drag.                   | none; axe-core is not a dependency yet       | untested |
| A14 | Screen reader matrix: VoiceOver with Safari, NVDA with Firefox and Chrome, JAWS with Chrome.        | manual                                       | untested |

### Performance

Each item names the rule of the baseline in the `pierre-layouts` intent. The
`bench` checks and their values are in the latest report in `bench/results/`.

| ID  | Rule                      | Checks                                                                                                                                                     |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Frame rate                | `zoom-no-dropped-frames`, `resize-no-dropped-frames`                                                                                                       |
| P2  | Main thread               | `zoom-busy-no-dropped-frames`, `zoom-no-main-thread-animation`                                                                                             |
| P3  | Time                      | `<operation>-main-thread-budget`, `resize-main-thread-per-step`                                                                                            |
| P4  | Independence from content | `focus-no-content-render`, `zoom-no-content-render`, `resize-no-content-render`, `zoom-one-content-resize`, `zoom-layout-once`, `*-independent-of-content` |
| P5  | Independence of layers    | `append-renders-one-pane`, `append-*-independent-of-panes`                                                                                                 |
| P6  | Compositing               | `zoom-animations-composited`, `split-animations-composited`                                                                                                |
| P7  | Hidden content            | `hidden-append-no-layout`, `hidden-append-no-paint`                                                                                                        |
| P8  | Scale                     | `<operation>-time-independent-of-panes`                                                                                                                    |

Firefox and Safari have no automated performance check. For each, record a
profile of a zoom and a resize drag with 16 heavy panes in the browser's
profiler, and note dropped frames and long tasks.
