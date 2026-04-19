# Choose your integration

## Why this page exists

- Help a new reader pick the right starting point without reading every API page
  first.
- Establish the core product shape early: one path-first tree model, two primary
  runtime entries.
- Send readers into the right quickstart and the right data-shaping guidance.

## Reader outcome

- Know whether to start with React or vanilla.
- Understand that canonical path strings are the public identity for tree items.
- Leave with the next two pages to read: the matching quickstart, then the
  tree-shape guide.

## Recommended path / defaults

- Start here before any runtime quickstart.
- Use Bun in examples first.
- Treat path strings as the stable public identity in docs, examples, selection
  state, search results, and item actions.
- Treat React and vanilla as two ways to drive the same model, not as two
  different products.

## Outline

### Start with the path-first model

- Explain the concept once, early.
- Cover:
  - canonical path strings are the public item identity
  - selection, focus, search results, rename, and drag/drop all talk about paths
  - docs should not teach row indexes or opaque IDs as the app-facing way to
    address items
- Cross-link: [Shared concepts](../reference/shared-concepts.md).

### Choose React when the app is already React-first

- Pick this path when:
  - app lifecycle and surrounding UI already live in React
  - the app wants `useFileTree(...)` to create the model
  - the app wants `<FileTree model={model} />` as a thin render wrapper over
    that model
- Keep the mental model explicit: the model is the state surface; the component
  renders it.
- Cross-link: [Get started with React](./get-started-with-react.md).

### Choose vanilla when you want the model directly

- Pick this path when:
  - the app is not React-based
  - the app wants direct imperative control through `new FileTree(...)`
  - another framework will wrap the vanilla model instead of expecting a
    first-class runtime package
- Keep the mental model explicit: the class instance is both the entry point and
  the state surface.
- Cross-link: [Get started with vanilla](./get-started-with-vanilla.md).

### Read the tree-shape guide next

- After either quickstart, send readers to the same data-shaping guide.
- Explain why:
  - small examples can start with simple `paths`
  - real application trees should move to prepared input
  - presorted input is the highest-performance prepared-input path when the
    server already knows the desired order
- Cross-link:
  [Shape tree data for fast rendering](./shape-tree-data-for-fast-rendering.md).

### Then add behavior and platform-specific layers

- Recommended next steps:
  - interaction state and default search guidance:
    [Navigate selection, focus, and search](./navigate-selection-focus-and-search.md)
  - rename, drag/drop, and optional command surfaces:
    [Rename, drag, and item actions](./rename-drag-and-item-actions.md)
  - hydration when server preload matters:
    [Hydrate a server-rendered tree](./hydrate-a-server-rendered-tree.md)
- Keep this short. This page should route, not inventory features.

## Example notes

- Show only two tiny start snippets:
  - React: `const { model } = useFileTree({ paths })` then
    `<FileTree model={model} />`
  - vanilla: `const tree = new FileTree({ paths })` then
    `tree.render({ fileTreeContainer })`
- Keep both snippets intentionally small and path-first.
- Do not turn this page into a feature matrix, install matrix, or API catalog.

## Out of scope

- Full API reference for either runtime.
- Exhaustive feature comparison tables.
- Server-preload or hydration detail.
- Direct `@pierre/path-store` guidance as the docs-facing integration story.
