# Get started with vanilla

## Why this page exists

- Give non-React users the primary runtime path for `@pierre/trees`.
- Teach the vanilla surface as class/model-first: construct the tree, then
  render it.
- Keep the scaling story honest: small trees can start with `paths`, but real
  app trees should move to prepared input produced outside the client.

## Reader outcome

- Install `@pierre/trees` with a short Bun-first command.
- Create the tree model with `new FileTree(...)`.
- Render it into the DOM with `render(...)`.
- Understand that the class instance is the primary state surface.
- Know when to stay with simple `paths` and when to move to prepared input.

## Recommended path / defaults

- Keep installation brief.
- Lead with `new FileTree(...)`, then `render(...)`.
- Use Bun first; mention npm and pnpm only as short secondary notes.
- Recommend prepared input produced on the server or another non-UI boundary for
  scalable trees.
- Keep `paths`-only examples for tiny demos, tests, and very small static trees.
- Keep vanilla as the primary non-React integration story; do not promote web
  components or unofficial wrappers to equal status.

## Outline

### Install `@pierre/trees`

- Primary command uses Bun.
- Keep npm and pnpm as one-line notes, not a package-manager matrix.
- Keep this section short and local to the quickstart.

### Create the model with `new FileTree(...)`

- Lead with this section.
- Explain:
  - the class instance is both the runtime entry point and the imperative model
    surface
  - the recommended scalable path is to pass `preparedInput` produced outside
    the client
  - the same constructor can still consume simple `paths` for genuinely small
    trees
- Reinforce path-first identity: app-facing item references remain canonical
  path strings.
- Cross-link: [Shared concepts](../reference/shared-concepts.md).

### Render into a host element

- Show `tree.render({ fileTreeContainer })` immediately after construction.
- Clarify the boundary:
  - the model owns tree state
  - rendering attaches that model to a host container
  - later app code keeps working through the model, not through DOM scraping
- Cross-link: [Vanilla API](../reference/vanilla-api.md).

### Read and update tree state through the model

- Keep this section at the model level.
- Cover:
  - read focused, selected, and search state from the instance
  - update search and focus through model methods
  - reset or replace paths through explicit model calls when data changes
  - dispose or clean up when the host goes away
- State the design plainly: the DOM host is not the source of truth; the model
  is.
- Cross-link:
  [Navigate selection, focus, and search](./navigate-selection-focus-and-search.md)
  and [Vanilla API](../reference/vanilla-api.md).

### Use simple `paths` input only when the tree is small

- Scope the low-ceremony path to:
  - local demos
  - tests
  - very small static trees
- Make the limit explicit: this is the easy starting path, not the scalable
  default.
- Cross-link:
  [Shape tree data for fast rendering](./shape-tree-data-for-fast-rendering.md).

### Move to prepared input before the tree gets expensive

- Explain the recommended handoff:
  - load canonical paths on the server or another non-UI boundary
  - prepare the tree input once
  - construct `new FileTree({ preparedInput, ... })`
- Keep presorted input as the highest-performance prepared-input variant when
  the server already knows the final order.
- Cross-link:
  [Shape tree data for fast rendering](./shape-tree-data-for-fast-rendering.md).

### Add hydration later when server rendering matters

- Keep this section short.
- Explain that hydration layers on top of the same class/model-first story; it
  is not a third primary runtime.
- Cross-link:
  [Hydrate a server-rendered tree](./hydrate-a-server-rendered-tree.md) and
  [Hydration API](../reference/hydration-api.md).

### Advanced note: wrapping the vanilla model in another framework

- Keep this clearly secondary.
- Explain the intended pattern:
  - create and own the `FileTree` instance from the host framework lifecycle
  - let that framework mount or unmount around the imperative model
  - do not imply official first-class wrappers beyond React
- Keep examples schematic.

## Example notes

- Primary example should be a TypeScript DOM snippet with this shape:
  - `const tree = new FileTree({ preparedInput, ... })`
  - `tree.render({ fileTreeContainer: container })`
- Keep styling, icons, and row annotations out of the quickstart body.

## Cross-links

- [Choose your integration](./choose-your-integration.md)
- [Shape tree data for fast rendering](./shape-tree-data-for-fast-rendering.md)
- [Navigate selection, focus, and search](./navigate-selection-focus-and-search.md)
- [Hydrate a server-rendered tree](./hydrate-a-server-rendered-tree.md)
- [Vanilla API](../reference/vanilla-api.md)

## Out of scope

- Official Svelte, Vue, or Solid runtime packages.
- Full SSR or hydration walkthroughs.
- Styling or theming walkthroughs.
- Direct custom-element-first integration as the recommended public path.
