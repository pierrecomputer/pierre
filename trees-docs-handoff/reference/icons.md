# Icons

Intent: lookup-oriented reference for icon sets, icon remapping rules, and
icon-specific configuration APIs.

## Ownership boundary

Owns:

- built-in icon sets
- icon configuration object shape
- remapping and sprite-sheet extension rules
- file-icon resolution order
- icon color behavior as surfaced through icon configuration

Does not own:

- broad styling and theming guidance
  ([styling and theming](./styling-and-theming.md))
- row annotations, git status semantics, or generic row-decoration behavior
- runtime quickstarts or general appearance narrative

## See also

- [Customize icons](../guides/customize-icons.md)
- [Style and theme the tree](../guides/style-and-theme-the-tree.md)
- [Styling and theming](./styling-and-theming.md)
- [React API](./react-api.md)
- [Vanilla API](./vanilla-api.md)

## Entry points

### Built-in set selection

- `icons: 'minimal' | 'standard' | 'complete'`
- Tiering direction:
  - `minimal` keeps core tree affordances only
  - `standard` adds common language and file-type icons
  - `complete` is the fullest built-in set
- Lead docs with built-in sets before custom remapping.

### Object configuration

- Use `FileTreeIconConfig` when a string set is not enough.
- This is the path for combining a built-in set with color toggles, slot remaps,
  or file-specific remaps.

## Configuration shape

### Base set and color mode

- `set?: 'minimal' | 'standard' | 'complete' | 'none'`
- `colored?: boolean`
- `set: 'none'` disables built-in file-type mappings. File rows still fall
  through to the generic file icon slot unless remaps replace it.
- `colored` controls whether supported built-in sets render semantic icon
  colors.

### Sprite-sheet extension

- `spriteSheet?: string`
- Supply an SVG string with additional `<symbol>` definitions that remaps can
  target.
- Keep this secondary to built-in sets and small remaps. Do not center full
  custom icon systems as the primary docs path.

### Built-in slot remapping

- `remap?: Record<string, RemappedIcon>`
- Core built-in slots worth documenting:
  - chevron
  - generic file icon
  - modified-state dot
  - locked-path icon
- Remaps may point to either:
  - a replacement symbol id string
  - an object with `name`, optional `width`, `height`, and `viewBox`

### File-specific remapping

- `byFileName` for exact basename matches such as `package.json` or `.gitignore`
- `byFileNameContains` for basename substring rules such as `dockerfile`
- `byFileExtension` for extension rules without a leading dot, including
  multi-part suffixes such as `spec.ts`
- These rules layer on top of the chosen base set.

## Resolution order

- File icon lookup resolves in this order:
  1. exact basename match from `byFileName`
  2. basename-contains match from `byFileNameContains`
  3. extension match from `byFileExtension`, with more specific suffixes winning
  4. built-in set mapping
  5. generic file-slot remap or fallback
- Example implication: `spec.ts` should beat `ts` when both rules exist.

## `RemappedIcon` shape

- `RemappedIcon` supports two forms:
  - string symbol id
  - object with `name`, optional `width`, `height`, and `viewBox`
- Use the object form when the replacement symbol needs non-default geometry
  metadata.

## Runtime touchpoints

### React

- Pass icon configuration through the model options used by `useFileTree(...)`.
- Leave runtime reconfiguration and component detail to
  [React API](./react-api.md).

### Vanilla

- Pass icon configuration at construction time.
- Update it later with `setIcons(...)`.
- Leave lifecycle detail to [Vanilla API](./vanilla-api.md).

## Icon color interplay

- Keep only the icon-specific part here.
- Built-in colored icons can be disabled with `colored: false`.
- Actual token lookup and fallback precedence live in
  [styling and theming](./styling-and-theming.md).
- Do not expand this section into a general theming guide.

## Exclusions and non-goals for this page

- no general theming walkthrough
- no row-annotation reference split
- no raw sprite-asset export story
- no duplication of runtime lifecycle docs
