# Style and theme the tree

## Why this page exists

- Teach the recommended appearance path without turning the guide into a
  selector catalog.
- Lead with host styling, CSS variables, and `themeToTreeStyles(...)`.
- Keep `unsafeCSS` explicit, narrow, and secondary.

## Reader outcome

- Know where layout styling ends and tree-internal theming begins.
- Reach for CSS variables before custom CSS injection.
- Use `themeToTreeStyles(...)` when the app already has a Shiki or VS Code-style
  theme.

## Recommended path / defaults

- Style the host first for panel size, placement, border, and background.
- Use `--trees-*` CSS variables for most tree appearance changes.
- Use `themeToTreeStyles(...)` when the tree should match an existing editor
  palette.
- Use `unsafeCSS` only when the supported host and variable surfaces cannot
  express the needed result.

## Outline

### Start with host styling

- Teach the host as the outer panel boundary.
- Cover the common decisions:
  - width, height, and viewport limits
  - border, radius, and background
  - how the tree sits in a sidebar, inspector, or full-height workspace pane
- Keep the runtime notes brief:
  - React: pass `className` and `style` to `<FileTree model={...} />`
  - Vanilla: style the mounted host element, using `getFileTreeContainer()` as
    the runtime touchpoint after `render(...)` or `hydrate(...)`.

### Use CSS variables for most visual changes

- Frame CSS variables as the main customization surface inside the shadow root.
- Organize examples by outcome, not by dumping every token:
  - selection and focus colors
  - panel and row chrome
  - search field contrast
  - icon and git-status color alignment when appearance changes need to stay
    consistent
- Reinforce the fallback chain once:
  1. explicit override variables
  2. `--trees-theme-*` variables from theme helpers
  3. library defaults
- Point the full token catalog to `../reference/styling-and-theming.md`.

### Match an editor palette with `themeToTreeStyles(...)`

- Introduce `themeToTreeStyles(...)` as the preferred path when the surrounding
  app already uses a VS Code or Shiki-style theme object.
- Explain what it buys the reader:
  - matching panel background and foreground
  - selection, focus, and input colors that fit the same palette
  - git-status colors that stay in the same theme family
- Show that explicit CSS variable overrides can still sit on top of the
  generated theme styles.
- Cross-link to `./show-git-status-and-row-annotations.md` for the meaning of
  git-status signals instead of restating them here.

### Choose the right styling layer

- Include a short decision section:
  - use host styles for layout and outer framing
  - use CSS variables for product-specific appearance changes
  - use `themeToTreeStyles(...)` when the tree should inherit an editor theme
  - in vanilla, reach the mounted host with `getFileTreeContainer()` when
    runtime styling needs the actual element
  - layer explicit overrides on top when the imported theme is close but not
    final

### `unsafeCSS` is the escape hatch

- Mark this section as advanced and optional.
- Explain when it is justified:
  - the supported variables do not reach the needed selector or state
  - a small presentation adjustment is needed on top of the public styling
    surfaces
  - the app accepts tighter coupling to tree markup for that narrow case
- Explain what not to do:
  - do not start here
  - do not rebuild the component's visual system from raw selectors
  - do not reintroduce raw `fileTreeStyles` or web-components internals as
    docs-facing paths
- Keep the example small and local.
- Point readers back to `../reference/styling-and-theming.md` for the lookup
  details.

## Example notes

- Sidebar panel with host border/background plus two CSS variable overrides.
- Full-height workspace tree using `themeToTreeStyles(...)` and one explicit
  selection-color override.
- Narrow `unsafeCSS` example that changes one hard-to-reach state without
  replacing the general styling system.

## Cross-links

- `../reference/styling-and-theming.md` for variable families, fallback details,
  and runtime-specific lookup notes.
- `./customize-icons.md` for icon-set choices and targeted icon remaps.
- `./show-git-status-and-row-annotations.md` for git-status meaning and
  row-level signals.

## Out of scope

- Exhaustive CSS variable tables.
- Icon remap rules or sprite-sheet workflows.
- Git-status semantics or row-annotation behavior.
- Raw `fileTreeStyles` usage.
- Web-components-specific styling paths.
