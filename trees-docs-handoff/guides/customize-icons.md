# Customize icons

## Why this page exists

- Teach the icon customization path without turning the guide into a full
  styling walkthrough.
- Lead with built-in icon sets, color mode, and small remaps.
- Keep custom sprite work secondary.

## Reader outcome

- Pick an appropriate built-in icon set.
- Adjust icon color behavior and remap a few important files without replacing
  the whole system.
- Recognize when a sprite sheet is justified.

## Recommended path / defaults

- Start with a built-in icon set.
- Adjust `colored` and a few targeted remaps before replacing the catalog.
- Reach for a sprite sheet only when the product already has a custom icon
  system or needs a few branded symbols the built-in sets do not cover.

## Outline

### Start with the built-in icon sets

- Introduce the built-in sets first:
  - `minimal`
  - `standard`
  - `complete`
- Explain the decision rule:
  - `minimal` for low-noise file and folder visuals
  - `standard` for common language and file-type recognition
  - `complete` for the broadest built-in coverage
- Keep the first example simple: the same tree rendered with each set.

### Adjust color mode before remapping icons

- Treat color mode as the next decision after set selection.
- Cover the practical choices:
  - leave built-in colored icons on when file-type recognition matters
  - set `colored: false` when the product uses a monochrome or subdued visual
    language
  - use the styling system for icon-color overrides instead of treating this
    page as a theme guide
- Cross-link to `./style-and-theme-the-tree.md` and
  `../reference/styling-and-theming.md` for the actual color-token story.

### Use the object form for targeted remaps

- Introduce `FileTreeIconConfig` as the path when a string set is not enough.
- Cover the remap surfaces in practical order:
  - `set` for the baseline built-in set
  - `remap` for built-in slots such as chevron, default file icon, dot, or lock
  - `byFileName` for exact basenames
  - `byFileExtension` for extension-driven overrides
  - `byFileNameContains` for broad patterns such as `dockerfile` or `license`
- Keep the examples small and high-value:
  - brand `package.json`
  - swap one lock icon
  - add one Dockerfile-style override

### Explain rule precedence once

- Keep this section conceptual, not exhaustive.
- Clarify that more specific file rules win over broad ones.
- Clarify that built-in mapping still handles everything the reader did not
  remap.
- Point detailed resolution order to `../reference/icons.md`.

### Use a sprite sheet only for advanced cases

- Position `spriteSheet` as the advanced path.
- Explain when it is worth it:
  - the app already has branded SVG symbols
  - a few product-specific icons must coexist with the built-in set
  - the reader wants custom symbols without rebuilding all file-type logic
- Keep the contract brief:
  - provide SVG `<symbol>` definitions
  - reference those symbols through remap rules
  - keep the rest of the resolution logic path-first and file-type-driven
- Do not turn this into a sprite authoring tutorial.

## Example notes

- Compare `minimal`, `standard`, and `complete` on the same sample tree.
- Switch the same built-in set between colored and monochrome modes.
- Remap `package.json` and `Dockerfile` while leaving the rest of the built-in
  mapping intact.
- Add one custom sprite symbol without replacing the whole icon catalog.

## Cross-links

- `./style-and-theme-the-tree.md` for broader appearance changes and
  CSS-variable-driven color overrides.
- `./show-git-status-and-row-annotations.md` when the reader is trying to add
  status signals rather than icon remaps.
- `../reference/icons.md` for full remap keys, resolution order, and icon-config
  lookup details.

## Out of scope

- General theming and layout guidance.
- Row-decoration semantics or git-status meaning.
- Full SVG authoring workflows.
- Raw style-asset or web-components customization paths.
