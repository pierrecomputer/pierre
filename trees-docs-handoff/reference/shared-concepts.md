# Shared concepts

Intent: lookup page for trees concepts that span React, vanilla, and hydration
docs.

## Ownership boundary

Owns:

- path-first identity
- simple path input vs prepared input vs presorted input
- shared option groups reused across runtimes
- search-mode semantics
- shared selection, focus, and item-handle vocabulary
- generic mutation vocabulary and event intent
- the conceptual framing that SSR preload returns an opaque handoff payload

Does not own:

- React hook usage or component props ([React API](./react-api.md))
- vanilla class construction, mounting, or lifecycle
  ([Vanilla API](./vanilla-api.md))
- preload and hydration handoff mechanics ([Hydration API](./hydration-api.md))
- styling, theme tokens, CSS variables, or `unsafeCSS`
  ([Styling and theming](./styling-and-theming.md))
- icon sets, remapping, or icon config details ([Icons](./icons.md))

## See also

- [Get started with React](../guides/get-started-with-react.md)
- [Get started with vanilla](../guides/get-started-with-vanilla.md)
- [Shape tree data for fast rendering](../guides/shape-tree-data-for-fast-rendering.md)
- [Navigate selection, focus, and search](../guides/navigate-selection-focus-and-search.md)
- [Hydrate a server-rendered tree](../guides/hydrate-a-server-rendered-tree.md)

## Path-first identity

- Public identity is the canonical path string.
- Readers should think in paths everywhere: selection, focus, drag and drop,
  rename, search matches, git-status attachment, and mutations.
- Files and directories share the same identity space. APIs distinguish kind
  when needed.
- Canonical path expectations:
  - forward slashes
  - nested segments imply directories
  - a trailing slash may mark an explicit directory when the input shape
    supports it
- Example note:
  - `src/components/Button.tsx` is the row identity, the selection value, and
    the mutation target.

## Input shapes

### Simple path input

- Small-tree, low-ceremony path: pass `paths` only.
- Good for demos, local tools, and small datasets where client-side preparation
  cost does not matter.
- Do not position this as the scale-oriented recommendation.
- Guide owner:
  [Shape tree data for fast rendering](../guides/shape-tree-data-for-fast-rendering.md).

### Prepared input

- Recommended scalable path: pass `preparedInput`.
- Preparation is reusable structural work done ahead of render, often on the
  server.
- The docs-facing helper surface lives in `@pierre/trees`:
  `prepareFileTreeInput(...)` and `preparePresortedFileTreeInput(...)`.
- Runtime pages should say only that they accept the same shared input shapes.

### Presorted input

- Highest-performance prepared-input variant when the server already knows the
  intended order.
- Position it as a specialization of prepared input, not as a synonym for any
  sorted array.
- Use it to avoid extra client sorting and preparation work.
- Guide owners:
  - [Shape tree data for fast rendering](../guides/shape-tree-data-for-fast-rendering.md)
  - [Handle large trees efficiently](../guides/handle-large-trees-efficiently.md)

## Shared options overview

- This page owns the cross-runtime meaning of shared options.
- Runtime references should list only their runtime-specific entry points, then
  link back here for option meaning.
- Final docs can include one comprehensive options table plus the grouped
  sections below.

## Shared option groups

### Data and identity options

- `paths`
- `preparedInput`
- `id`
- Notes:
  - `paths` and `preparedInput` define the tree model’s source data.
  - `id` matters for host identity and for matching server-preloaded output with
    the client runtime.

### Tree-shape options

- `initialExpansion`
- `initialExpandedPaths`
- `flattenEmptyDirectories`
- `sort`
- Notes:
  - tree-shape guidance belongs in the tree-shape guide; this page stays
    lookup-first
  - client-side sorting is secondary to prepared and presorted input
  - custom comparators belong on the secondary, reference-heavy path

### Search options

- `search`
- `initialSearchQuery`
- `fileTreeSearchMode`
- `onSearchChange`
- This page owns the meaning of the search modes once for all runtimes.

### Selection and focus concepts

- selected paths
- focused path
- item handles returned by path lookup
- callback and subscription surfaces that notify external state
- Guide owner:
  [Navigate selection, focus, and search](../guides/navigate-selection-focus-and-search.md).

### Interaction and editing options

- `dragAndDrop`
- `renaming`
- `composition`
- Keep the meaning runtime-agnostic here. User workflows belong in
  [Rename, drag, and item actions](../guides/rename-drag-and-item-actions.md).

### Appearance and annotation options

- `gitStatus`
- `icons`
- `renderRowDecoration`
- Cross-link deep lookup detail instead of duplicating it:
  - [Styling and theming](./styling-and-theming.md)
  - [Icons](./icons.md)
  - [Show git status and row annotations](../guides/show-git-status-and-row-annotations.md)

### Scale and rendering settings

- built-in virtualized rendering behavior
- host element CSS height (steady-state viewport size comes from layout)
- `itemHeight`
- `overscan`
- `initialVisibleRowCount` (first-render row budget before layout is measured)
- Position these as tuning knobs, not as quickstart concepts.
- Guide owner:
  [Handle large trees efficiently](../guides/handle-large-trees-efficiently.md).

## Search-mode semantics

- Runtime pages should not restate the mode matrix. They should say the runtime
  uses the shared search modes and link here.
- `hide-non-matches`
  - recommended guide default
  - filters visible rows to matches plus the ancestor chain needed to keep those
    matches navigable
- `collapse-non-matches`
  - keeps matching paths and the ancestor chain visible
  - collapses unrelated branches out of the way
- `expand-matches`
  - expands matching branches into surrounding tree context
  - keeps non-matching rows visible instead of filtering the tree down to
    matches

## Selection, focus, and item handles

- Selection is path-based, not row-index-based.
- Focus is path-based and can move independently from selection.
- Item handles expose path-oriented actions for a known item.
- Lookup topics to cover:
  - get an item by path
  - read focused and selected state
  - focus, select, toggle, or deselect through the model or item handle
  - directory-only actions such as `expand()`, `collapse()`, and `toggle()`
- Scope boundary:
  - React state wiring belongs in [React API](./react-api.md)
  - imperative class usage belongs in [Vanilla API](./vanilla-api.md)

## Mutation vocabulary

- Own the generic event vocabulary once.
- Shared operations and topics:
  - `add`
  - `remove`
  - `move`
  - `batch`
  - `resetPaths`
  - `onMutation`
  - mutation event types: `add`, `remove`, `move`, `reset`, `batch`
- Frame mutation events as semantic tree changes, not DOM updates.
- Explain what callers use them for:
  - syncing adjacent UI state
  - analytics or logging
  - bridging to persistence or collaboration layers
- Event-shape notes:
  - payloads stay path-first
  - reset events can say whether prepared input was involved
  - invalidation fields say whether canonical state or projected visible state
    changed
- Scope boundary:
  - not a filesystem-sync tutorial
  - not a renderer-internals page
- Workflow guide owner:
  [Rename, drag, and item actions](../guides/rename-drag-and-item-actions.md).

## Opaque SSR payload framing

- Conceptual contract only: server preload returns one opaque handoff object.
- Docs should tell readers to pass it forward unchanged.
- Runtime pages may name their handoff point (`preloadedData` in React,
  `hydrate(...)` in vanilla) but should not turn that into field-by-field
  payload choreography.
- Full preload and hydration mechanics live in
  [Hydration API](./hydration-api.md).

## Exclusions and non-goals for this page

- no React hook signatures beyond cross-links
- no vanilla render or hydrate walkthrough
- no preload payload field contract
- no CSS variable catalog
- no icon remap catalog
- no standalone row-annotation reference split
