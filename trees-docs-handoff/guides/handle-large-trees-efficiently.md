# Handle large trees efficiently

## Purpose

- Give readers a scale guide that stays practical and user-facing.
- Lead with prepared input, presorted input, and minimizing client work before
  talking about rendering.
- Keep built-in virtualization visible as a user benefit, not as an internal API
  tour.

## Audience and entry point

- Readers are moving from small demos to repo-scale or workspace-scale trees.
- They need to know what to change before shaping, sorting, hydration, or reset
  work becomes expensive.
- This page should stay decision-oriented rather than benchmark-oriented.

## Start with the main recommendation

- State the default split early:
  - for small trees and low-ceremony demos, simple `paths` input is fine
  - for larger trees, prefer prepared input
  - when the server already owns ordering, prefer presorted prepared input
- Explain the core idea in one sentence: large-tree performance starts by
  avoiding unnecessary client work, not by teaching low-level rendering
  internals.

## Part 1: Prepare input before it reaches the client

- Make this the first major section.
- Explain why raw path arrays stop scaling well:
  - the client pays shaping and sorting cost repeatedly
  - resets and hydration can redo work the server already knows
  - server-owned ordering should not be recomputed on the client by default
- Recommended teaching order:
  1. `preparedInput` as the scalable default concept
  2. presorted prepared input as the highest-performance prepared-input variant
     when ordering is already known
  3. plain `paths` as the low-ceremony fallback for intentionally small trees
- Reinforce the docs position directly: prepared input is a first-class public
  concept, not an internal optimization trick.

## Decision points to cover

- Use prepared input when the server or loader already has the full tree
  snapshot.
- Use presorted prepared input when the server already knows canonical ordering.
- Keep raw `paths` for small examples, demos, and tests where readability
  matters more than scale.
- Minimize client recomputation when surrounding UI state changes, filtering
  changes, or hydration runs.

## Part 2: Keep rendering work small

- Explain the rendering story after the input story.
- User-facing points to cover:
  - the tree renders a window of rows by default, including a small overscan
    around the visible viewport
  - most users do not need custom virtualization primitives
  - viewport sizing matters because virtualization needs a real visible window
- Focus on options users actually reason about:
  - `viewportHeight`
  - row density or item height only when the visual design truly changes it
  - expansion and search choices because they affect how many rows stay in the
    rendered window at once
- Keep the language on outcomes: the tree mounts the visible slice plus
  overscan, large expanded trees stay usable, and the guide should not teach
  internal range/window helpers.

## SSR and hydration at scale

- Add a short section that connects this guide to hydration without duplicating
  the hydration guide.
- Key points:
  - server preload pairs naturally with prepared input
  - large trees benefit when the server does the expensive shape and order work
    once
  - hydration should consume the same prepared-input story instead of inventing
    a separate large-tree path
- Cross-link: `./hydrate-a-server-rendered-tree.md`.

## Common pitfalls

- Sending only raw `paths` for huge server-known datasets.
- Re-sorting on the client after the server already chose the order.
- Treating low-level virtualization helpers as part of the recommended public
  workflow.
- Expanding or rebuilding everything unnecessarily when surrounding UI state
  changes.
- Turning the guide into a benchmark checklist instead of a data-shaping guide.

## Paired examples to include

- Small demo tree with `paths` only, clearly labeled as a low-ceremony choice.
- Recommended server/client example using prepared input.
- Highest-scale example using presorted prepared input plus SSR/hydration
  handoff.
- Large expanded workspace example showing that built-in virtualization is
  usually enough.

## Cross-links

- `./shape-tree-data-for-fast-rendering.md`
- `./hydrate-a-server-rendered-tree.md`
- `../reference/shared-concepts.md`
- `../reference/react-api.md`
- `../reference/vanilla-api.md`

## Scope boundaries

- On this page:
  - scale-oriented input preparation
  - prepared and presorted input recommendations
  - user-facing virtualization guidance
  - practical large-tree decisions
- Not on this page:
  - raw virtualization helper APIs
  - benchmark methodology
  - renderer internals
  - a standalone performance reference family
