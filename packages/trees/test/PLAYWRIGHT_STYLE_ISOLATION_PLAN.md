# Playwright Plan: FileTree Shadow Style Isolation

## Goals

1. Verify styles outside `file-tree-container` do not style internals inside its
   shadow root.
2. Verify FileTree internal styles do not leak into the light DOM outside the
   component.
3. Verify CSS custom properties (theming variables) set on host/light DOM are
   consumed inside the shadow root.

## Why Browser Tests

This behavior depends on real CSS cascade + shadow DOM boundaries. Unit tests in
jsdom are insufficient for robust style computation assertions. We need a real
browser engine.

## Test Surface

Target package: `packages/trees`

Fixture style:

- Static HTML fixture loaded by Playwright.
- Uses built package outputs from `packages/trees/dist`.
- Renders one `file-tree-container` via `FileTree` and adds explicit control
  nodes outside the component.

## Assertions

### 1) External styles do not leak into shadow root

Setup:

- Add global style in light DOM:
  - `#some-known-internal-id { color: rgb(0, 128, 0) !important; }`
- Place a light-DOM control node with that id (should turn green).
- Also give the same id to an element inside the FileTree shadow root.

Checks:

- Light-DOM control node computed color is green.
- Shadow-root element with same id is **not** green.

### 2) Internal FileTree styles do not leak out

Setup:

- Render a light-DOM control node that mimics FileTree internal
  attributes/classes.

Checks:

- Control node does not pick up FileTree internal visual rules (e.g. no selected
  background/border from `[data-type='item'][data-item-selected='true']` shadow
  styles).

### 3) CSS custom properties flow into shadow root

Setup:

- Set a host-level custom property such as `--ft-selected-background-color`.
- Select an item inside FileTree.

Checks:

- Selected item inside shadow root resolves to the configured value.

## Implementation Steps

1. Add Playwright dependency and scripts for `packages/trees`.
2. Add Playwright config in `packages/trees` and run tests in Chromium.
3. Add static fixture page under `packages/trees/test/e2e/fixtures`.
4. Add spec file under `packages/trees/test/e2e` with three tests above.
5. Run tests and stabilize selectors/assertions.

## Non-goals (This Pass)

- Cross-browser matrix (Chromium-only initially).
- Screenshot snapshots/visual diffing.
- Full docs app E2E coverage.

## Follow-ups

1. Add WebKit/Firefox once baseline is stable.
2. Integrate into CI (job + browser install step).
3. Add SSR fixture variant to validate style behavior for declarative shadow DOM
   output.
