# Styling and theming

Intent: lookup-oriented reference for styling APIs, CSS variables, host styling
patterns, and theme helper usage.

## Ownership boundary

Owns:

- host styling entry points
- CSS custom property families and fallback precedence
- theme helper APIs such as `themeToTreeStyles(...)`
- styling-specific lookup notes for runtime consumers
- `unsafeCSS` as an explicit secondary escape hatch

Does not own:

- narrative customization workflow
  ([Style and theme the tree](../guides/style-and-theme-the-tree.md))
- icon-specific configuration details ([icons](./icons.md))
- row-annotation behavior or git-status semantics as standalone references
- raw `fileTreeStyles` or low-level style-asset integrations as a first-class
  docs path

## See also

- [Style and theme the tree](../guides/style-and-theme-the-tree.md)
- [Customize icons](../guides/customize-icons.md)
- [Show git status and row annotations](../guides/show-git-status-and-row-annotations.md)
- [React API](./react-api.md)
- [Vanilla API](./vanilla-api.md)

## Styling entry points

### Host styling

- Style the outer host first.
- React: use normal host `className` and `style` props.
- Vanilla: style the mounted host returned by `getFileTreeContainer()`.
- Host styling owns outer layout and panel treatment:
  - width, height, and max-height
  - borders and panel chrome
  - placement inside the surrounding layout
- Host styles frame the component. CSS variables theme the UI rendered inside
  it.

### CSS custom properties

- Organize the reference by token families, not one flat variable dump.
- Core families:
  - panel/background/foreground tokens
  - interactive row state tokens for hover, selection, and focus
  - input and search tokens
  - git-status color tokens
  - icon color tokens when built-in colored icons are enabled
- This page owns the fallback-chain explanation once. The guide should not
  repeat it in detail.

## Fallback precedence

- Styling resolves in this order:
  1. explicit override variables such as `--trees-*-override`
  2. `--trees-theme-*` variables supplied by theme helpers
  3. library defaults
- `themeToTreeStyles(...)` fills the middle layer. Targeted overrides still win.

## `themeToTreeStyles(...)`

### Purpose

- Maps a VS Code or Shiki-style theme object to host styles plus
  `--trees-theme-*` variables.
- Useful when the surrounding app already has an editor-like palette.

### Input shape

- `TreeThemeInput`
- Key fields:
  - `type`
  - `bg`
  - `fg`
  - `colors`

### Output shape

- `TreeThemeStyles`
- Compatible with React inline styles and vanilla host style assignment.

### What the helper owns

- Host-level styles:
  - `colorScheme`
  - `backgroundColor`
  - `color`
  - `borderColor`
- Theme-variable families derived from the input theme:
  - sidebar/panel background and foreground
  - section/header foreground
  - hover and active-selection colors
  - focus ring
  - input background and border
  - git added, modified, and deleted colors
- The helper is not the last word. Explicit override variables can still replace
  any derived token.

## Runtime touchpoints

### React

- Styling stays on the host element through normal `className` and `style`
  props.
- There is no separate React-only styling API beyond shared tree options.
- Hydration-specific appearance parity belongs in
  [Hydration API](./hydration-api.md) only when markup identity depends on it.

### Vanilla

- Apply styles through the host or container you already own.
- `getFileTreeContainer()` is the handoff back to application styling code.

## `unsafeCSS` escape hatch

- Secondary path. Do not present it before host styling, CSS variables, and
  `themeToTreeStyles(...)`.
- Use only when the supported host and variable surfaces cannot express the
  needed customization.
- Reference topics:
  - option name and public package surface
  - high-level shadow-root injection behavior
  - warning that this is an exception path, not the default styling story
- Do not turn this subsection into a raw stylesheet-asset guide.

## Styling exclusions

- no dedicated section for raw `fileTreeStyles`
- no first-class web-component-internals styling story
- no icon remap matrix here; link to [icons](./icons.md)
- no standalone row-annotation reference split
