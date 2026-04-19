# Vanilla API

Intent: lookup page for the class-first runtime exported from `@pierre/trees`.

## Ownership boundary

Owns:

- `new FileTree(...)` as the primary vanilla entry point
- render, hydrate, unmount, and cleanup lifecycle methods
- imperative model methods and item-handle lookup
- vanilla-specific mounting and container ownership details

Does not own:

- shared input-shape guidance, search-mode semantics, mutation vocabulary, or
  path-first identity ([Shared concepts](./shared-concepts.md))
- preload payload rules or hydration choreography
  ([Hydration API](./hydration-api.md))
- styling and theming detail ([Styling and theming](./styling-and-theming.md))
- icon configuration detail ([Icons](./icons.md))

## See also

- [Get started with vanilla](../guides/get-started-with-vanilla.md)
- [Rename, drag, and item actions](../guides/rename-drag-and-item-actions.md)
- [Hydrate a server-rendered tree](../guides/hydrate-a-server-rendered-tree.md)
- [Shared concepts](./shared-concepts.md)
- [Hydration API](./hydration-api.md)

## Class-first story

- Lead with `new FileTree(options)`.
- The class is both the rendered runtime and the imperative model surface.
- Follow construction with mounting methods, not with shared-options
  explanation.
- Small example note:
  - `const tree = new FileTree({ paths, search: true })`
  - `tree.render({ fileTreeContainer })`
- Shared option meaning belongs in [Shared concepts](./shared-concepts.md).

## Constructor surface

### `new FileTree(options)`

- accepts the shared options surface
- establishes the model once
- later updates happen through model methods instead of rebuilding option
  objects for every render
- cross-link shared input shapes, `id`, search modes, and mutation vocabulary to
  [Shared concepts](./shared-concepts.md)

## Mounting and lifecycle

### `render(...)`

- accepted mounting shapes:
  - `{ fileTreeContainer }`
  - `{ containerWrapper }`
- clarify ownership:
  - reuse an existing host element when one is provided
  - or create and append a host when mounting through the wrapper path

### `hydrate(...)`

- vanilla hydration entry point for already-rendered tree markup
- keep this page to the runtime entry point only
- full preload and hydration rules live in [Hydration API](./hydration-api.md)

### `unmount()`

- removes the mounted runtime while keeping the model available

### `cleanUp()`

- final teardown: unmount plus subscriptions and model cleanup

### `getFileTreeContainer()`

- host lookup helper after mount
- styling detail defers to [Styling and theming](./styling-and-theming.md)

## Read APIs

- `getItem(path)`
- `getFocusedItem()`
- `getFocusedPath()`
- `getSelectedPaths()`
- `getComposition()`
- search snapshot methods:
  - `isSearchOpen()`
  - `getSearchValue()`
  - `getSearchMatchingPaths()`
- Explain that reads are path- and model-oriented, not row-index- or
  DOM-oriented.

## Item handles

- Summarize the handle APIs returned by `getItem(path)`.
- Common handle actions:
  - `getPath()`
  - `focus()`
  - `select()`
  - `toggleSelect()`
  - `deselect()`
  - directory-only actions: `expand()`, `collapse()`, `toggle()`
- Shared item-handle vocabulary belongs in
  [Shared concepts](./shared-concepts.md).
- Workflow examples belong in
  [Rename, drag, and item actions](../guides/rename-drag-and-item-actions.md).

## Write and control APIs

### Focus and selection control

- `focusPath(path)`
- `focusNearestPath(path | null)`
- `startRenaming(path?)`
- item-handle methods for focused and selected rows

### Search control

- `setSearch(value)`
- `openSearch(initialValue?)`
- `closeSearch()`
- `focusNextSearchMatch()`
- `focusPreviousSearchMatch()`
- Defer search-mode semantics to [Shared concepts](./shared-concepts.md).

### Data and mutation control

- `add(path)`
- `remove(path, options?)`
- `move(fromPath, toPath, options?)`
- `batch(operations)`
- `resetPaths(paths, options?)`
- `onMutation(type, handler)`
- Keep event-shape detail brief here. Shared mutation vocabulary belongs in
  [Shared concepts](./shared-concepts.md).

### Runtime reconfiguration helpers

- `setComposition(composition?)`
- `setGitStatus(gitStatus?)`
- `setIcons(icons?)`
- Explain that these rerender runtime facets without changing the shared meaning
  of the underlying options.
- Appearance specifics defer to [Styling and theming](./styling-and-theming.md)
  and [Icons](./icons.md).

## Subscriptions and external systems

- `subscribe(listener)` for snapshot-driven external integration
- `onMutation(...)` for semantic tree changes
- Example note:
  - use `subscribe` when any tree change should refresh a derived snapshot
  - use `onMutation` when add, remove, move, reset, or batch intent matters

## Composition surface

- lookup topics:
  - header composition
  - context menu composition
  - when to update composition through `setComposition(...)`
- user-facing command design belongs in
  [Rename, drag, and item actions](../guides/rename-drag-and-item-actions.md)

## Hydration boundary

- This page only names the vanilla hydration entry point:
  `hydrate({ fileTreeContainer })`.
- Full server-preload-first handoff lives in
  [Hydration API](./hydration-api.md).

## Appearance boundary

- This page only names runtime touchpoints such as `getFileTreeContainer()`,
  `setGitStatus(...)`, and `setIcons(...)`.
- CSS variables, theme helpers, host styling, and the `unsafeCSS` escape hatch
  belong in [Styling and theming](./styling-and-theming.md).
- Icon sets and remapping belong in [Icons](./icons.md).

## Exclusions and non-goals for this page

- no duplicate shared options matrix
- no prepared-input mini-guide
- no search-mode matrix
- no SSR payload field contract
- no web-component-internals section
