# Hydration API

Intent: lookup page for server preload and client hydration APIs across the
trees runtimes.

## Ownership boundary

Owns:

- `@pierre/trees/ssr` as the preload entry point
- `preloadFileTree(...)`
- opaque SSR payload framing
- the server-to-client handoff contract for React and vanilla
- option parity rules that make hydration valid

Does not own:

- runtime quickstarts or integration setup
- full React runtime lookup details (`react-api.md`)
- full vanilla runtime lookup details (`vanilla-api.md`)
- shared non-hydration option semantics (`shared-concepts.md`)
- styling, icon, or DOM-internals reference material

## See also

- [Hydrate a server-rendered tree](../guides/hydrate-a-server-rendered-tree.md)
- [React API](./react-api.md)
- [Vanilla API](./vanilla-api.md)
- [Shared concepts](./shared-concepts.md)

## Server-preload-first contract

- Lead with the server step, not the client step.
- Import preload utilities from `@pierre/trees/ssr`.
- Call `preloadFileTree(options)` on the server.
- Pass the returned value forward as one opaque handoff object.
- Treat hydration as reuse of that server work, not as a second rendering
  strategy with a separate data contract.

## `preloadFileTree(...)`

### Purpose

- Pre-renders the tree for first paint before the client runtime takes over.
- Uses the same tree-defining options model as the client runtime.

### Input

- `FileTreeOptions`
- Use the same `paths` or prepared-input story you intend to use on the client.

### Output

- Opaque SSR payload.
- The current exported payload type name is `FileTreeSsrPayload`, but docs
  should still teach readers to pass the value through unchanged.

## Opaque payload framing

- The payload is a handoff object, not a field-by-field integration surface.
- Docs may name the runtime touchpoints that consume it:
  - React passes it as `preloadedData`.
  - Vanilla calls the `FileTree` instance method
    `fileTree.hydrate({ fileTreeContainer })` against server-rendered markup
    already in the page.
- Do not center `html`, `shadowHtml`, or `id` choreography as the docs story.

## Handoff rules

### Option parity

- Server and client must agree on the same tree-defining options.
- Match these inputs when they affect rendered structure or first state:
  - same path source (`paths`, prepared input, or presorted prepared input)
  - same `id` discipline
  - same expansion and search-affecting options when relevant
  - same appearance-affecting options when they change rendered markup or icon
    output
- Mismatches are not a supported partial merge. They produce hydration mismatch
  or incorrect initial state.

### Identity

- `id` belongs here because the server and client must refer to the same tree
  instance.
- Keep this at the contract level. Do not turn it into a DOM-structure page.

### Prepared input

- Hydration works with simple paths or prepared input.
- The scalable path is server-prepared input with matching client consumption.
- Shared input-shape semantics live in [Shared concepts](./shared-concepts.md).

## React handoff

- `useFileTree(...)` still creates the model.
- Pass the payload to `<FileTree model={model} preloadedData={payload} />`.
- React may suppress hydration warnings when preloaded content is present.
- Leave full prop and lifecycle lookup to [React API](./react-api.md).

## Vanilla handoff

- Emit the server-rendered tree into the page first.
- Create `const fileTree = new FileTree(options)` on the client with matching
  tree-defining options.
- Call the instance method `fileTree.hydrate({ fileTreeContainer })` against
  that existing host.
- Leave constructor, render, and runtime lifecycle detail to
  [Vanilla API](./vanilla-api.md).

## Advanced note boundary

- If final docs mention declarative shadow DOM or hydration-warning handling,
  keep that note short and secondary.
- Do not turn this page into a DOM internals reference.

## Exclusions and non-goals for this page

- no runtime quickstart duplication
- no raw SSR payload field choreography as a primary docs surface
- no full DOM-structure contract
- no styling or icon lookup detail
