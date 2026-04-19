# Get started with React

## Why this page exists

- Give React users the shortest honest path from install to a working tree.
- Teach the React surface as hook/model-first, not component-first.
- Keep the scaling story honest: small trees can start with `paths`, but real
  app trees should move to prepared input produced outside the client.

## Reader outcome

- Install the package with a short Bun-first command.
- Create the tree model with `useFileTree(...)` from `@pierre/trees/react`.
- Render it with `<FileTree model={model} />` from `@pierre/trees/react`.
- Understand that the model is the primary state surface; the component renders
  it.
- Know when to stay with simple `paths` and when to move to prepared input.

## Recommended path / defaults

- Keep installation brief.
- Lead with `useFileTree(...)`, then `<FileTree model={model} />`.
- Use Bun first; mention npm and pnpm only as short secondary notes.
- Recommend prepared input produced on the server or another non-UI boundary for
  scalable trees.
- Keep `paths`-only examples for tiny demos, tests, and very small static trees.

## Outline

### Install `@pierre/trees`

- Primary command uses Bun.
- Keep npm and pnpm as one-line notes, not a package-manager matrix.
- If the published React entry point requires an extra package at release time,
  update the install line here instead of expanding the page into
  package-surface history.

### Create the model with `useFileTree(...)`

- Lead with this section.
- Explain:
  - `useFileTree(...)` from `@pierre/trees/react` creates a stable imperative
    tree model for the component lifetime
  - the recommended scalable path is to pass `preparedInput` produced outside
    the client
  - the same hook can still consume simple `paths` for genuinely small trees
- Reinforce path-first identity: app-facing item references remain canonical
  path strings.
- Cross-link: [Shared concepts](../reference/shared-concepts.md).

### Render with `<FileTree model={model} />`

- Show the minimum render step immediately after model creation.
- Clarify the boundary:
  - `<FileTree />` from `@pierre/trees/react` mounts the model into the host
    element
  - `useFileTree(...)` creates and owns that model
  - ongoing tree changes happen through model methods and selector hooks, not a
    large controlled-prop surface
- Cross-link: [React API](../reference/react-api.md).

### Read and update tree state through the model

- Keep this section first-class.
- Cover:
  - read selection with `useFileTreeSelection(model)`
  - read search state with `useFileTreeSearch(model)`
  - derive snapshots with `useFileTreeSelector(model, selector, equality?)`
  - write back through model methods such as `setSearch(...)`, `focusPath(...)`,
    and `resetPaths(...)`
- State the design plainly: React does not replace the model as the source of
  truth.
- Cross-link:
  [Navigate selection, focus, and search](./navigate-selection-focus-and-search.md)
  and [React API](../reference/react-api.md).

### Use simple `paths` input only when the tree is small

- Scope the low-ceremony path to:
  - local demos
  - tests
  - small static trees
- Make the limit explicit: this is the easy starting path, not the scalable
  default.
- Cross-link:
  [Shape tree data for fast rendering](./shape-tree-data-for-fast-rendering.md).

### Move to prepared input before the tree gets expensive

- Explain the recommended handoff:
  - load canonical paths on the server or another non-UI boundary
  - prepare the tree input once
  - pass `preparedInput` into `useFileTree(...)`
- Keep presorted input as the highest-performance prepared-input variant when
  the server already knows the final order.
- Cross-link:
  [Shape tree data for fast rendering](./shape-tree-data-for-fast-rendering.md).

### Add hydration later when SSR matters

- Keep this section short.
- Explain that hydration layers on top of the same model-first React story; it
  is not a third primary runtime.
- Cross-link:
  [Hydrate a server-rendered tree](./hydrate-a-server-rendered-tree.md) and
  [Hydration API](../reference/hydration-api.md).

## Example notes

- Primary example should be a small TSX component with this shape:
  - `const { model } = useFileTree({ preparedInput, ... })`
  - `<FileTree model={model} />`
- Keep styling, icons, and row annotations out of the quickstart body.

## Cross-links

- [Choose your integration](./choose-your-integration.md)
- [Shape tree data for fast rendering](./shape-tree-data-for-fast-rendering.md)
- [Navigate selection, focus, and search](./navigate-selection-focus-and-search.md)
- [Hydrate a server-rendered tree](./hydrate-a-server-rendered-tree.md)
- [Style and theme the tree](./style-and-theme-the-tree.md)
- [React API](../reference/react-api.md)

## Out of scope

- Full shared options tables.
- Detailed hydration payload rules.
- Styling or theming walkthroughs.
- Web-component-first or non-React-wrapper-first integration stories.
