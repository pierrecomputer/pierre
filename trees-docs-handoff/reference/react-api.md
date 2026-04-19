# React API

Intent: lookup page for the React entry point in `@pierre/trees/react`, centered
on the model-first React surface.

## Ownership boundary

Owns:

- `useFileTree(...)` as the primary React entry point
- `<FileTree model={...} />` as the React rendering surface
- React selector hooks
- React-specific composition props such as `header` and `renderContextMenu`
- React-specific guidance for reading from and writing to the imperative model

Does not own:

- shared option meaning, input-shape guidance, search-mode semantics, or
  mutation vocabulary ([Shared concepts](./shared-concepts.md))
- preload payload rules or hydration choreography
  ([Hydration API](./hydration-api.md))
- styling and theming detail ([Styling and theming](./styling-and-theming.md))
- icon configuration detail ([Icons](./icons.md))

## See also

- [Get started with React](../guides/get-started-with-react.md)
- [Navigate selection, focus, and search](../guides/navigate-selection-focus-and-search.md)
- [Hydrate a server-rendered tree](../guides/hydrate-a-server-rendered-tree.md)
- [Shared concepts](./shared-concepts.md)
- [Hydration API](./hydration-api.md)

## React model-first story

- Lead with `useFileTree(options)`.
- The hook creates one stable imperative model for the component lifetime.
- React is a thin integration layer over that model, not a separate state model.
- Later option changes are not a controlled reconfiguration path. Ongoing
  updates happen through model methods such as `resetPaths(...)`,
  `setComposition(...)`, `setIcons(...)`, or search and mutation methods.
- Small example note:
  - `const { model } = useFileTree({ paths, search: true })`
  - `<FileTree model={model} />`
- Defer shared option meaning to [Shared concepts](./shared-concepts.md).

## `useFileTree(...)`

### Purpose

- Create the model exactly once and clean it up on unmount.

### Return value

- `UseFileTreeResult`
- `model: FileTree`

### What belongs here

- stable model lifetime within the component
- cleanup on unmount
- why callers should not treat the hook as a controlled prop adapter
- cross-runtime truth that the same `FileTree` model also underlies vanilla
  usage

### Cross-links

- shared inputs, options, search modes, and mutation vocabulary:
  [Shared concepts](./shared-concepts.md)
- preload and hydration handoff: [Hydration API](./hydration-api.md)

## `<FileTree />`

### Primary props

- `model`
- normal host HTML attributes passed to the host element
- `id` override behavior when coordinating with preloaded content

### React-only props

- `header`
- `renderContextMenu`
- `preloadedData`

### Behavioral notes

- mounts the model into the host element
- if preloaded content already exists, hydrates instead of rendering fresh
- uses `id ?? preloadedData?.id` for host identity when preloaded content is
  involved
- `header` and `renderContextMenu` layer React rendering onto the model’s
  composition surface

### Boundaries

- hydrate rules stay in [Hydration API](./hydration-api.md)
- host styling, CSS variables, theme helpers, and `unsafeCSS` stay in
  [Styling and theming](./styling-and-theming.md)
- icon set and remap detail stays in [Icons](./icons.md)

## Reading tree state from React

- Treat this as a first-class pattern, not an advanced appendix.
- React components read model state through selector hooks and write back
  through model methods.
- Common tasks:
  - read selected paths for sibling UI
  - read search state for React controls
  - derive focused or custom snapshots with a selector
  - call model methods in response to app commands

## Selector hooks

### `useFileTreeSelector(model, selector, equality?)`

- generic bridge from the imperative model into React
- document by purpose, not `useSyncExternalStore` internals
- lookup topics:
  - selector function
  - optional equality function
  - stable selected snapshots that avoid unrelated rerenders
- Example note:
  - derive whether a specific path is focused without rerendering on unrelated
    tree changes

### `useFileTreeSelection(model)`

- convenience hook for selected-path snapshots
- returns `readonly string[]`
- selection semantics belong to [Shared concepts](./shared-concepts.md)

### `useFileTreeSearch(model)`

- convenience hook bundling search snapshot plus search actions
- lookup surface:
  - `isOpen`
  - `value`
  - `matchingPaths`
  - `open(initialValue?)`
  - `close()`
  - `setValue(value)`
  - `focusNextMatch()`
  - `focusPreviousMatch()`
- Search-mode semantics belong to [Shared concepts](./shared-concepts.md).

## Writing to the model from React

- React writes through the same imperative model methods vanilla uses.
- Common write paths to name here:
  - focus and selection methods
  - search methods
  - mutation methods such as `add`, `remove`, `move`, `batch`, and `resetPaths`
  - runtime reconfiguration methods such as `setComposition(...)`,
    `setGitStatus(...)`, and `setIcons(...)`
- Keep this section runtime-specific: how React code calls the model.
- Defer the shared meaning of those APIs to
  [Shared concepts](./shared-concepts.md).

## React-specific composition surface

- `header` prop for React-rendered header content
- `renderContextMenu(item, context)` for React-rendered context menus
- Explain that these are React affordances layered onto the model’s composition
  APIs.
- Cross-link user-facing workflows to
  [Rename, drag, and item actions](../guides/rename-drag-and-item-actions.md).

## Mutation and subscriptions from React

- Keep this as a lookup bridge, not a workflow guide.
- Name the two common patterns:
  - selector hooks for reactive reads
  - `onMutation(...)` for semantic side effects
- Mutation vocabulary and event intent belong to
  [Shared concepts](./shared-concepts.md).

## Hydration boundary

- This page only names the React handoff points:
  - `preloadedData`
  - stable model plus matching tree-defining options
  - host `id` coordination when preloaded content is present
- Payload shape, preload flow, and hydration rules live in
  [Hydration API](./hydration-api.md).

## Appearance boundary

- React callers style the host through normal host props such as `className` and
  `style`.
- CSS variables, theme helpers, and `unsafeCSS` live in
  [Styling and theming](./styling-and-theming.md).
- Icon set and remap lookup lives in [Icons](./icons.md).

## Exclusions and non-goals for this page

- no full shared options matrix
- no prepared-input mini-guide
- no search-mode matrix
- no field-by-field SSR payload contract
- no CSS variable list
- no icon remap catalog
