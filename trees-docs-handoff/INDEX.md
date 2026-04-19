# Trees docs handoff index

This folder is the canonical first-phase handoff for the new `@pierre/trees`
docs set.

It is guide-first, with curated reference underneath. It describes the shipped
documented surface, not every internal detail in the repo.

## Directory map

- `guides/` — task and workflow outlines for the primary reader journey
- `reference/` — lookup-oriented outlines for shared concepts and endorsed API
  surfaces
- `notes/` — supporting notes for intentional exclusions

## Recommended guide-first reading sequence

1. [Choose your integration](./guides/choose-your-integration.md) — orient the
   reader, choose React or vanilla, and introduce path-first identity.
2. [Get started with React](./guides/get-started-with-react.md) or
   [Get started with vanilla](./guides/get-started-with-vanilla.md) — take the
   matching runtime quickstart.
3. [Shape tree data for fast rendering](./guides/shape-tree-data-for-fast-rendering.md)
   — learn the prepared and presorted input story.
4. [Navigate selection, focus, and search](./guides/navigate-selection-focus-and-search.md)
   — learn interaction state first, then search.
5. [Rename, drag, and trigger item actions](./guides/rename-drag-and-item-actions.md)
   — learn direct item actions, then optional command surfaces.
6. [Style and theme the tree](./guides/style-and-theme-the-tree.md) — learn the
   default appearance path.
7. [Customize icons](./guides/customize-icons.md) — learn icon sets, color mode,
   and targeted remaps.
8. [Show Git status and row annotations](./guides/show-git-status-and-row-annotations.md)
   — learn built-in Git status first, then custom row decorations.
9. [Handle large trees efficiently](./guides/handle-large-trees-efficiently.md)
   — learn the scale-oriented input and rendering guidance.
10. [Hydrate a server-rendered tree](./guides/hydrate-a-server-rendered-tree.md)
    — learn the server-preload-first hydration flow.

## Recommended reference lookup sequence

1. [Shared concepts](./reference/shared-concepts.md) — path-first identity,
   shared input shapes, search modes, mutation vocabulary, and other
   cross-cutting semantics.
2. [React API](./reference/react-api.md) or
   [Vanilla API](./reference/vanilla-api.md) — runtime-specific lookup.
3. [Hydration API](./reference/hydration-api.md) — preload and hydration lookup,
   with the SSR payload treated as opaque.
4. [Styling and theming](./reference/styling-and-theming.md) — host styling, CSS
   variables, theme helpers, and the `unsafeCSS` escape hatch.
5. [Icons](./reference/icons.md) — icon sets, icon config, remapping, and
   resolution order.

## File inventory by directory

### Guides

| File                                            | Title                                  | Role                         |
| ----------------------------------------------- | -------------------------------------- | ---------------------------- |
| `guides/choose-your-integration.md`             | Choose your integration                | chooser and orientation page |
| `guides/get-started-with-react.md`              | Get started with React                 | React quickstart             |
| `guides/get-started-with-vanilla.md`            | Get started with vanilla               | vanilla quickstart           |
| `guides/shape-tree-data-for-fast-rendering.md`  | Shape tree data for fast rendering     | tree-shape and input guide   |
| `guides/navigate-selection-focus-and-search.md` | Navigate selection, focus, and search  | navigation and state guide   |
| `guides/rename-drag-and-item-actions.md`        | Rename, drag, and trigger item actions | item-actions guide           |
| `guides/style-and-theme-the-tree.md`            | Style and theme the tree               | styling and theming guide    |
| `guides/customize-icons.md`                     | Customize icons                        | icons guide                  |
| `guides/show-git-status-and-row-annotations.md` | Show Git status and row annotations    | row-annotations guide        |
| `guides/handle-large-trees-efficiently.md`      | Handle large trees efficiently         | performance-at-scale guide   |
| `guides/hydrate-a-server-rendered-tree.md`      | Hydrate a server-rendered tree         | hydration guide              |

### Reference

| File                               | Title               | Role                                               |
| ---------------------------------- | ------------------- | -------------------------------------------------- |
| `reference/shared-concepts.md`     | Shared concepts     | cross-cutting concepts and shared option semantics |
| `reference/react-api.md`           | React API           | React runtime reference                            |
| `reference/vanilla-api.md`         | Vanilla API         | vanilla runtime reference                          |
| `reference/hydration-api.md`       | Hydration API       | preload and hydration reference                    |
| `reference/styling-and-theming.md` | Styling and theming | styling and theme lookup reference                 |
| `reference/icons.md`               | Icons               | icon lookup reference                              |

### Notes

| File                  | Title                 | Role                                                                           |
| --------------------- | --------------------- | ------------------------------------------------------------------------------ |
| `notes/EXCLUSIONS.md` | Trees docs exclusions | intentionally omitted current surfaces and future ideas that are not ready yet |

## Publication rule

- Publish these pages only while the package surface matches the documented
  surface.
- Update this handoff in the same change as any public API shift.
