# Trees docs exclusions

Purpose: record what the first canonical trees docs set intentionally leaves
out, and why. This is not a backlog. These exclusions keep the published docs
focused on the supported story instead of every surface or idea that currently
exists.

## Intentionally undocumented current surfaces

### `FileTreeController`

- Out because the docs story centers the shipped runtime surface: `FileTree`,
  `@pierre/trees/react`, and hydration.
- The controller boundary is explicitly described as a Phase 0 draft in
  `packages/trees/src/model/CONTROLLER_BOUNDARY.md`.
- Documenting it now would teach headless and custom-renderer usage before we
  decide to support that as part of the product story.
- Follow-up: keep it in code-change notes as a de-export candidate.

### Low-level virtualization helpers and constants

- Includes `computeVisibleRange`, `computeWindowRange`,
  `computeStickyWindowLayout`, `FILE_TREE_DEFAULT_ITEM_HEIGHT`,
  `FILE_TREE_DEFAULT_OVERSCAN`, and `FILE_TREE_DEFAULT_VIEWPORT_HEIGHT` from
  `@pierre/trees`.
- Out because the performance docs are user-facing guidance about scale behavior
  and recommended inputs, not renderer-internals documentation.
- Documenting these would pull the docs toward custom rendering and performance
  primitives instead of the supported tree usage path.
- Follow-up: keep them in code-change notes as de-export candidates.

### Raw `fileTreeStyles`

- Out because the intended styling story is higher-level: host styling, CSS
  variables, `themeToTreeStyles`, and an explicit `unsafeCss` escape hatch if
  that API lands.
- The current observed use is internal SSR and style assembly, not a first-pass
  user workflow.
- Documenting the raw stylesheet export would encourage low-level integration
  patterns the docs are not endorsing.
- Follow-up: keep it in code-change notes as a de-export candidate.

### `@pierre/trees/web-components` as a primary integration path

- The side-effect entrypoint exists and registers `<file-tree-container>`, but
  it does not get its own top-level docs page.
- Out because the agreed docs shape is React quickstart, vanilla quickstart,
  then shared capability guides — not a third “web components” runtime.
- Direct integration against `<file-tree-container>` is not the recommended
  public path; it may be mentioned briefly where shadow-root behavior matters.

### Raw SSR payload field choreography

- Out because the agreed docs treat the `preloadFileTree(...)` result as one
  opaque handoff object, not a field-by-field contract.
- The payload may be referenced as `payload`, `preloadedData`, or similar
  handoff data depending on runtime, but the docs should not lead with `html` /
  `shadowHtml` / `id` choreography.
- This keeps the hydration docs focused on the supported preload and hydrate
  workflow rather than internal payload structure.

### `@pierre/path-store` as the docs-facing prepared-input package

- Out because prepared input is a first-class trees concept, but
  `@pierre/path-store` is not the package users should be sent to from the trees
  docs.
- Until trees-native helper exports exist, the docs can describe the dependency
  in notes, but should not bless `@pierre/path-store` as the public integration
  surface.

## Future or use-case ideas that are explicitly not ready yet

### Headless and custom-renderer guidance

- Includes “build your own renderer,” “reuse the engine with your own shell,”
  and similar controller-first patterns.
- Out because this would turn the docs into an engine and platform story before
  that boundary is stable or intentionally supported.
- The current evidence is mostly internal, test, and benchmark oriented rather
  than a mature external workflow.

### Official other-framework guides

- Includes Svelte, Vue, and Solid integrations as first-class supported pages.
- Out because the current agreement is only a brief advanced interoperability
  note in vanilla docs, with React cited as one wrapper pattern.
- We are not ready to imply official support breadth across frameworks.

### Full filesystem or server synchronization tutorial

- Out because mutation events are worth documenting, but the end-to-end sync
  workflow is not ready to be promised as a complete supported story.
- The first docs set should stay at generic mutation and state-synchronization
  primitives, not claim a full remote filesystem protocol or authoritative sync
  architecture.

### Performance and profiling internals

- Out because the performance area is meant to tell users when scale matters and
  what inputs or options reduce client work.
- It is not meant to document internal virtualization math, profiling fixtures,
  benchmark methodology, or renderer-tuning internals.

### Standalone accessibility workflow page

- Out because the agreed shape is to document keyboard, focus, and other
  concrete behaviors where they belong, not to create a separate accessibility
  guide without a user workflow.
- This avoids an abstract accessibility page that duplicates runtime and
  navigation behavior docs.

### Dedicated utilities or reference bucket for leftovers

- Out because the agreed rule is not to create a generic utilities page just
  because a few APIs do not fit neatly yet.
- A new utilities or reference family should exist only if several real
  documented-surface APIs accumulate with no better home.
