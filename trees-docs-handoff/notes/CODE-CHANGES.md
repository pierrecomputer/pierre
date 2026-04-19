# Trees code changes

Purpose: package and API changes the docs plan depends on, ordered by docs
impact rather than implementation sequence.

## 1. Add a trees-native prepared-input surface to `@pierre/trees`

Why this is first:

- The planned docs treat prepared and presorted input as the recommended scale
  path, not an appendix.
- Today `FileTree` accepts `preparedInput`, but the helper and type surface
  still lives in `@pierre/path-store`, which is not the package we want the docs
  to send users to.
- Without a trees-native surface, the core tree-shape and performance guidance
  would either point to the wrong package or blur the recommended server path.

Observed evidence:

- `packages/trees/src/model/types.ts` exposes `preparedInput` on tree options
  and reset options.
- `packages/trees/src/index.ts` does not expose helper functions or a
  prepared-input type.
- `packages/path-store/src/store.ts` exposes `PathStore.prepareInput(...)` and
  `PathStore.preparePresortedInput(...)`.
- `packages/path-store/src/public-types.ts` defines `PathStorePreparedInput`.
- Existing benchmark and profiling code already treats prepared input as the
  performant path: `packages/trees/scripts/benchmarkFileTreeGetItem.ts`,
  `packages/trees/scripts/lib/fileTreeProfileShared.ts`.

Suggested change:

- Re-export a trees-native prepared-input contract from `@pierre/trees`.
- Preferred docs-facing names: `FileTreePreparedInput`, `prepareFileTreeInput`,
  and `preparePresortedFileTreeInput`.
- Keep `@pierre/path-store` as an implementation detail, not the docs-facing
  package.

Docs impact:

- Unblocks honest quickstart and reference guidance for server-assisted path
  preparation.
- Lets the docs keep the recommended scale path inside `@pierre/trees`.

## 2. Add an `unsafeCss` escape hatch to the public trees API

Why this is next:

- The planned styling story keeps CSS variables and theme helpers as the
  default, but it still needs one explicit escape hatch.
- That escape hatch already appears in docs material, but it does not exist in
  the current public trees surface.
- We should not document an option that is not shipped.

Observed evidence:

- Existing docs mention `unsafeCSS`:
  `apps/docs/app/trees/docs/Styling/content.mdx` and related constants files.
- Current public trees types do not expose `unsafeCss`:
  `packages/trees/src/model/types.ts`.
- Current trees source search does not show an implemented `unsafeCss` option in
  the shipped package surface.

Suggested change:

- Add `unsafeCss` to the public trees options surface.
- Document it as an explicit escape hatch, not the default styling path.
- Use current naming style: `unsafeCss`, not `unsafeCSS`.

Docs impact:

- Unblocks the planned styling guide and reference without stale option names or
  invented API coverage.

## 3. Stop exporting `FileTreeController` for now

Why it matters:

- The first docs set is about using the shipped tree product, not building on
  the engine beneath it.
- Leaving this exported while omitting it from docs keeps the public package
  wider than the supported story.

Observed evidence:

- Root export exists in `packages/trees/src/index.ts`.
- `packages/trees/src/model/CONTROLLER_BOUNDARY.md` says the controller boundary
  is a Phase 0 draft, not a frozen public contract.
- Interview decision: leave it out because “we dont want people to use this
  yet.”

Suggested change:

- Remove the root export of `FileTreeController` until we intentionally support
  and document a headless controller story.

Docs impact:

- Keeps docs and exports aligned around `FileTree`, React, and hydration instead
  of implying headless or custom-renderer support.

## 4. Stop exporting low-level virtualization helpers for now

Why it matters:

- The docs will explain scale behavior and recommended inputs, but they are
  intentionally not a custom-renderer or renderer-internals manual.
- These exports invite the low-level integration story the docs are explicitly
  declining to teach.

Observed evidence:

- Root exports exist in `packages/trees/src/index.ts`: `computeVisibleRange`,
  `computeWindowRange`, `computeStickyWindowLayout`,
  `FILE_TREE_DEFAULT_ITEM_HEIGHT`, `FILE_TREE_DEFAULT_OVERSCAN`,
  `FILE_TREE_DEFAULT_VIEWPORT_HEIGHT`.
- Definitions live in `packages/trees/src/model/virtualization.ts`.
- Internal renderer usage appears in `packages/trees/src/render/FileTree.ts`.
- Prior session review found test and internal usage but no strong user-facing
  docs home.

Suggested change:

- Remove those root exports until low-level virtualization primitives become an
  intentional external story.

Docs impact:

- Prevents the reference layer from being pulled toward renderer-primitive
  coverage that does not belong in the first docs set.

## 5. Stop exporting raw `fileTreeStyles` for now

Why it matters:

- The planned styling docs already have a cleaner public story: host styling,
  CSS variables, `themeToTreeStyles`, and the proposed `unsafeCss` escape hatch.
- Exporting the raw stylesheet invites lower-level SSR and asset wiring that the
  docs are explicitly not centering.

Observed evidence:

- Root export exists in `packages/trees/src/index.ts`.
- Internal SSR assembly uses it in `packages/trees/src/render/FileTree.ts`.
- There is no intended first-pass docs page centered on raw stylesheet asset
  integration.

Suggested change:

- Remove `fileTreeStyles` from the root public surface unless raw style-asset
  integration becomes a deliberate supported path later.

Docs impact:

- Keeps the styling story focused on the supported customization layers instead
  of leaking renderer assembly details.
