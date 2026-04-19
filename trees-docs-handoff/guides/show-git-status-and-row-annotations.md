# Show Git status and row annotations

## Why this page exists

- Teach the row-signal path without turning the guide into a repo-sync tutorial.
- Lead with built-in `gitStatus` for the common case.
- Introduce `renderRowDecoration` as the secondary path for product-specific
  metadata.

## Reader outcome

- Know when built-in `gitStatus` is enough.
- Know when to add `renderRowDecoration` instead of inventing a fake Git state.
- Keep row signals visually aligned with the broader appearance system.

## Recommended path / defaults

- Start with `gitStatus` when the signal matches the built-in Git lane: `added`,
  `modified`, `deleted`, `ignored`, `renamed`, or `untracked`.
- Update the current status set as surrounding app state changes.
- Use `renderRowDecoration` when the row needs metadata that is not Git-like.
- Use both together only when the row needs Git state plus one additional
  product-specific signal.

## Outline

### Start with built-in `gitStatus`

- Introduce `gitStatus` as the default row-annotation path.
- Explain the data shape in prose:
  - statuses attach to canonical paths
  - folders can reflect changed descendants automatically
- Emphasize why it should lead:
  - no custom renderer required
  - the tree owns the common status lane
  - colors can flow through the same styling and theme system
- Keep React and vanilla integration notes short:
  - React: pass `gitStatus` through `useFileTree(...)`
  - Vanilla: pass `gitStatus` to `new FileTree(...)`

### Know when `gitStatus` is enough

- Include a short decision section:
  - use `gitStatus` for built-in Git-style `added`, `modified`, `deleted`,
    `ignored`, `renamed`, and `untracked` state
  - prefer it over custom row rendering when the semantics already match
  - let styling and theming control colors instead of rebuilding the lane
    yourself
- Cross-link to `../reference/shared-concepts.md` for the shared path-first
  model behind these updates.

### Update status sets over time

- Cover the practical story of replacing the current status data:
  - switching commits, branches, or comparison views
  - clearing annotations when the surrounding view turns status display off
  - refreshing the current set after an external change
- Keep this at the level of replacing the status input or calling the runtime
  update hook.
- Do not promise filesystem watching, repository indexing, or end-to-end sync.

### Add custom row annotations with `renderRowDecoration`

- Position `renderRowDecoration` as the next step when the row needs non-Git
  metadata.
- Use examples that stay clearly outside Git semantics:
  - generated-file badge
  - remote-storage indicator
  - validation or error marker
  - lightweight count or secondary label
- Clarify that `renderRowDecoration` complements `gitStatus`; it is not the
  default replacement for it.
- Mention that action surfaces can still coexist alongside row decorations
  without turning this page into an item-actions guide.

### Choose between the two paths

- Use `gitStatus` when the meaning is Git-like.
- Use `renderRowDecoration` for everything else.
- Use both together when the row needs Git state plus one extra product-specific
  signal.
- Keep the examples focused on one clear signal per row before combining them.

### Keep row signals readable

- Encourage terse, glanceable annotations.
- If a decoration changes user decisions, make the example include accessible
  text or tooltip support.
- If a decoration is purely supplemental, keep it low-noise.
- Avoid loading the primary example with multiple competing badges.

### Keep styling separate from annotation meaning

- Note that git-status colors and decoration visuals should harmonize with the
  surrounding tree theme.
- Cross-link to `./style-and-theme-the-tree.md` instead of restating the styling
  system here.
- Cross-link to `./customize-icons.md` only when the reader is actually changing
  icons rather than adding row metadata.

## Example notes

- Built-in `gitStatus` example with one change set, then a reset that clears the
  statuses.
- Git status plus one product-specific badge on a subset of files.
- Pure `renderRowDecoration` example for non-Git metadata.

## Cross-links

- `./style-and-theme-the-tree.md` for color and theme control.
- `./customize-icons.md` when the appearance problem is really icon choice or
  icon remapping.
- `../reference/shared-concepts.md` for path-first identity and shared
  appearance options.

## Out of scope

- Full repository synchronization or watcher tutorials.
- General theming walkthroughs.
- Icon remap systems.
- Low-level renderer or lane internals.
