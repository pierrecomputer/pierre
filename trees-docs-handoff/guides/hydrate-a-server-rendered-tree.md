# Hydrate a server-rendered tree

## Purpose

- Teach the server-preload-first hydration flow.
- Present React and vanilla side by side as two client hydration paths over the
  same server-preload step.
- Treat the SSR payload as opaque throughout the guide.
- Distinguish the client boundary clearly: React receives the payload as
  `preloadedData`, while vanilla hydrates the server-rendered DOM with a
  `FileTree` instance.

## Audience and entry point

- Readers already know the basic React or vanilla integration path.
- They now want fast first paint plus interactive hydration.
- This page layers on top of the runtime quickstarts instead of replacing them.

## Start with the server step

- Lead with `preloadFileTree(...)` from `@pierre/trees/ssr`.
- Explain the story in three steps:
  1. the server prepares and preloads the tree once
  2. React receives one opaque SSR handoff object, while vanilla receives the
     server-rendered tree already in the page
  3. the client hydrates that existing output instead of rebuilding a parallel
     surface
- Keep the framing high level: this guide teaches the handoff flow, not the
  payload’s internal field layout.

## Core invariants

- Hydration is not a third primary runtime. It is a server-preload layer on top
  of React or vanilla.
- The client must use the same tree options and state assumptions that the
  server used for preload.
- Path-first identity and surrounding app state decisions should stay consistent
  across the server/client boundary.

## React flow

- Teach the React path as:
  1. the server calls `preloadFileTree(...)`
  2. the client creates the model with `useFileTree(...)`
  3. the app renders `<FileTree model={model} preloadedData={payload} />`
- Keep the React framing model-first: `useFileTree(...)` still owns the client
  model, and `preloadedData` is the handoff prop that activates hydration.
- Example notes:
  - colocated server and client components are fine
  - keep runtime options aligned across the handoff
  - headers, menus, and other composition still sit on the normal React surface
    after hydration

## Vanilla flow

- Teach vanilla side by side with React, not as an appendix.
- Recommended sequence:
  1. the server calls `preloadFileTree(...)`
  2. the server emits the rendered tree container into the page
  3. the client constructs `new FileTree(...)` with matching options
  4. the client finds the existing container and calls
     `fileTree.hydrate({ fileTreeContainer })`
- Keep the vanilla framing class-first: `new FileTree(...)` creates the model,
  and the `FileTree` instance method attaches that model to the server-rendered
  tree already on the page.
- Do not imply that vanilla consumes the React-style SSR payload object on the
  client; vanilla reuses the rendered DOM that the server already emitted.
- If the expected server-rendered container is missing, note the practical
  fallback: render normally instead of hydrating.

## Treat the payload as a handoff object

- Include a short explicit section in the final docs.
- State the rule plainly: readers should pass the SSR payload through as one
  object.
- Refer lower-level payload fields to `../reference/hydration-api.md` instead of
  unpacking them in the guide.
- In examples and prose, say “SSR payload,” “handoff object,” or `preloadedData`
  rather than teaching raw field choreography.

## Pair hydration with prepared input when trees are large

- Keep this section short.
- Explain the scaling guidance:
  - large-tree SSR usually pairs best with prepared input
  - presorted prepared input is the best fit when the server already owns
    ordering
  - the client should consume that prepared result instead of recomputing it
- Cross-link: `./handle-large-trees-efficiently.md`.

## Composition and interactivity after hydration

- Reassure readers that hydration keeps the same feature surface:
  - selection, focus, and search still work
  - rename and drag/drop still work when configured
  - React composition still uses the same wrapper/component surface
  - vanilla code can still call model APIs after hydration
- Phrase this as “same model, pre-rendered start,” not as a separate capability
  set.

## Advanced note: declarative shadow DOM and hydration warnings

- Keep this section clearly labeled as advanced.
- Explain that the server-preloaded path uses declarative shadow DOM.
- For React, note that the host element can require hydration-warning handling
  around server-rendered markup ownership.
- Keep the advice practical: use the packaged runtime behavior instead of
  inventing custom DOM diffing or raw payload plumbing.
- Mention browser support only at a high level; do not turn this into a
  browser-support appendix.

## Common mistakes to warn against

- Recreating different options on the client than the server used for preload.
- Treating hydration as a third primary runtime.
- Documenting raw payload fields as the recommended public story.
- Re-rendering fresh client markup when the server-rendered tree is already
  present and intended for hydration.

## Paired examples to include

- Minimal React SSR/hydration example.
- Minimal vanilla SSR/hydration example.
- Large-tree example that preloads on the server and hydrates with prepared
  input.
- One advanced note/example showing the declarative-shadow-DOM host plus
  hydration-warning handling.

## Cross-links

- `./get-started-with-react.md`
- `./get-started-with-vanilla.md`
- `./handle-large-trees-efficiently.md`
- `../reference/react-api.md`
- `../reference/vanilla-api.md`
- `../reference/hydration-api.md`

## Scope boundaries

- On this page:
  - server-preload-first flow
  - React and vanilla hydration side by side
  - opaque payload framing
  - declarative shadow DOM and hydration-warning advanced guidance
- Not on this page:
  - raw payload field choreography as the main tutorial
  - web-components internals as a primary path
  - standalone SSR-as-runtime framing
