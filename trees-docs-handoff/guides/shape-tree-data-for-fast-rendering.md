# Shape tree data for fast rendering

## Why this page exists

- Teach the recommended data-shaping path before readers run into scale problems
  by accident.
- Make prepared input the default scalable story.
- Explain how simple `paths`, prepared input, and presorted input relate without
  collapsing them into one idea.

## Reader outcome

- Prefer prepared input for real application trees.
- Understand why server-side preparation reduces client work.
- Know when simple `paths` is still enough.
- Know that presorted input is the highest-performance prepared-input variant.

## Recommended path / defaults

- Lead with prepared input as the recommended path.
- Show server-side preparation plus client consumption as the primary example
  shape.
- Scope `paths`-only input to small trees, local demos, tests, and other
  low-ceremony cases.
- Treat presorted input as the top-end prepared-input variant when the server
  already knows the desired order.
- Keep client-side sorting and comparator work secondary.

## Outline

### Start with server-prepared input for scalable trees

- Lead with this section.
- Explain:
  - prepared input lets the client skip tree-preparation work
  - the recommended architecture prepares tree input on the server or another
    non-UI boundary
  - the client still works with the same path-first model; only the preparation
    step moves earlier
- Cross-link: [Shared concepts](../reference/shared-concepts.md).

### Pass `preparedInput` into the runtime

- Keep the runtime story simple and shared.
- Explain that both quickstarts consume the same prepared payload shape:
  - React passes it into `useFileTree(...)`
  - vanilla passes it into `new FileTree(...)`
- Cross-link: [Get started with React](./get-started-with-react.md) and
  [Get started with vanilla](./get-started-with-vanilla.md).

### Use simple `paths` input only for small trees

- Scope this path clearly:
  - small demos
  - tests
  - very small static trees
  - local-only cases where preparation cost is trivial
- State the limit plainly: this is the low-ceremony path, not the scalable
  default.
- Tell readers to come back to this guide when the tree grows or reload cost
  starts to matter.

### Presorted input is the highest-performance prepared-input path

- Define it as a specialization of prepared input, not as a separate competing
  concept.
- Explain:
  - prepared input removes client preparation work
  - presorted input also removes extra ordering work when the server already
    knows the final order
  - this is the best fit when the backend, indexer, or build step already owns
    sorting
- Keep exact sort contracts and advanced comparator details in
  reference/performance pages.

### Prepare on the server, render on the client

- Show the preferred split:
  - server loads canonical paths
  - server prepares tree input once
  - client runtime consumes `preparedInput`
- Explain why this is the default scalable path:
  - less client CPU work
  - more predictable startup cost
  - one prepared payload can feed React, vanilla, and hydration flows
- Cross-link:
  [Hydrate a server-rendered tree](./hydrate-a-server-rendered-tree.md).

### Keep client-side sorting and preparation secondary

- Acknowledge the cases where data only exists on the client or custom ordering
  must run there.
- Keep the guidance short:
  - use this when you must, not as the default docs path
  - prefer prepared input first when the app can move work out of the UI
- Route detailed option and comparator behavior to reference and scale-oriented
  docs.

### Connect this guide to the rest of the onboarding arc

- React quickstart: [Get started with React](./get-started-with-react.md)
- Vanilla quickstart: [Get started with vanilla](./get-started-with-vanilla.md)
- Interaction state and default search guidance:
  [Navigate selection, focus, and search](./navigate-selection-focus-and-search.md)
- Hydration with the same prepared payload discipline:
  [Hydrate a server-rendered tree](./hydrate-a-server-rendered-tree.md)

## Example notes

- Primary example should be split into server and client snippets in TypeScript
  / TSX.
- Lead with a server-prepared example before any client-only example.
- Include one small `paths`-only snippet labeled for demos or small trees.
- If presorted input gets a sample, keep it focused on helper usage rather than
  reimplementing default ordering manually.

## Out of scope

- Virtualization internals or benchmark methodology.
- Exhaustive comparator API detail.
- Direct `@pierre/path-store` usage as the docs-facing story.
- Repeating hydration payload mechanics.
