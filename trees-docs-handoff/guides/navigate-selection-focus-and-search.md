# Navigate selection, focus, and search

## Purpose

- Teach the core interaction state first: selection, focus, and keyboard
  movement through the visible tree.
- Introduce search as a layer on that same path-first model, not as a separate
  navigation system.
- Keep alternate search modes and exhaustive option tables in reference.

## Audience and entry point

- Readers already render a tree in React or vanilla.
- They now need to reason about current item state, keyboard behavior, and a
  basic search box.
- This page should explain the interaction model once, then point to
  runtime-specific wiring details.

## Start with the interaction state model

- Lead with the three states users notice immediately:

- selection
- focus/current row
- keyboard movement through visible rows
- Name path-first identity early: selection and focus track canonical paths, not
  row indexes.
- Explain the payoff: rename, drag/drop, and search all build on this same
  state.
- Cross-link: `../reference/shared-concepts.md`.

## Selection and focus are related but different

- Define the distinction directly:
  - focus says where keyboard actions land
  - selection says which item or items the app treats as chosen
  - they often move together, but the guide should not describe them as
    interchangeable
- Keep the examples path-first. If the current row changes because expansion or
  filtering changes visibility, the app still reasons about paths.

## Keyboard navigation follows the visible tree

- Cover the user-facing rules, not the full key matrix:
  - keyboard movement follows the currently visible expanded tree
  - collapsing and expanding changes which rows can receive focus next
  - focus should stay predictable when the visible shape changes
- Keep raw key tables and renderer internals out of the guide. Link to
  runtime/reference docs for exact bindings if needed.

## Add search on top of that same state

- Introduce search only after selection and focus are clear.
- Explain search in terms of the existing model:
  - search matches against the same path-first tree data
  - filtering changes what is visible, but does not invent a new identity model
  - selection and current focus should stay legible as matches appear or
    disappear
- Do not introduce a separate search/navigation reference page here.

## Guide default: `hide-non-matches`

- Recommend `hide-non-matches` as the default guide behavior.
- Explain why this is the starting point:
  - it matches the common “find the item I want” task
  - it keeps the visible tree aligned with the current search intent
  - it gives the guide one clear recommendation while leaving alternate modes to
    reference
- Keep alternate display modes secondary. Mention them briefly, then link to
  API/reference docs instead of teaching them as co-equal patterns.

## React and vanilla integration notes

- Explain the concept once. Split only where the runtime integration differs.
- React notes:
  - keep the docs model-first with `useFileTree(...)`
  - wire search inputs, selection reads, and focused-item UI around the model
    used by `<FileTree model={...} />`
- Vanilla notes:
  - keep the docs class-first with `new FileTree(...)`
  - wire search input, focus handling, and surrounding UI around the same model
    before `render(...)` or `hydrate(...)`
- Cross-links: `./get-started-with-react.md`, `./get-started-with-vanilla.md`,
  `../reference/react-api.md`, `../reference/vanilla-api.md`.

## Paired examples to include

- One conceptual example that names the interaction state in plain terms.
- One React example that starts with selection/focus state, then adds a small
  search box using `hide-non-matches`.
- One vanilla example with the same behavior and the same path-first
  assumptions.
- Use TypeScript / TSX.

## Cross-links

- `./shape-tree-data-for-fast-rendering.md`
- `./get-started-with-react.md`
- `./get-started-with-vanilla.md`
- `../reference/shared-concepts.md`
- `../reference/react-api.md`
- `../reference/vanilla-api.md`

## Scope boundaries

- On this page:
  - selection
  - focus/current row
  - keyboard navigation as a visible-tree behavior
  - search with `hide-non-matches` as the guide default
- Not on this page:
  - drag/drop and rename workflows
  - exhaustive keyboard shortcut tables
  - alternate search modes as co-equal recommendations
  - mutation/event synchronization details beyond what navigation state needs
