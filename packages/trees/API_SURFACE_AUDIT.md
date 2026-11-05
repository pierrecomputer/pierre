# @pierre/trees public API surface audit

This file inventories the public API surface of `@pierre/trees` as observed in
the current worktree. It is intentionally descriptive: it lists what users can
import, what options and types exist, and what runtime contracts are implied by
source, generated declarations, package metadata, and docs.

## Scope and sources

Observed sources:

- `packages/trees/package.json`
- `packages/trees/src/index.ts`
- `packages/trees/src/react/index.ts`
- `packages/trees/src/ssr/index.ts`
- `packages/trees/src/web-components.ts`
- `packages/trees/src/model/publicTypes.ts`
- `packages/trees/src/render/FileTree.ts`
- `packages/trees/src/react/*.ts(x)`
- `packages/trees/src/preparedInput.ts`
- `packages/trees/src/iconConfig.ts`
- `packages/trees/src/builtInIcons.ts`
- `packages/trees/src/render/iconResolver.ts`
- `packages/trees/src/utils/themeToTreeStyles.ts`
- `packages/trees/src/components/web-components.ts`
- `packages/trees/src/style.css`
- generated declaration files under `packages/trees/dist/**` after
  `bun run build`

Package version observed: `1.0.0-beta.3`.

The package export map exposes four public entry points. Build output contains
many more `dist/**` declaration and JavaScript files because `tsdown` currently
builds `src/**/*.ts` and `src/**/*.tsx`, but `package.json` only exports these
subpaths:

| Subpath            | Intended import                | Exported values/types                                                                          |
| ------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `.`                | `@pierre/trees`                | Core vanilla model, prepared input helpers, SSR helpers, icons, theming, constants, core types |
| `./react`          | `@pierre/trees/react`          | React component and hooks                                                                      |
| `./ssr`            | `@pierre/trees/ssr`            | SSR preload and payload serialization helpers                                                  |
| `./web-components` | `@pierre/trees/web-components` | Custom-element registration side effect plus low-level shadow-root helpers                     |

## Root entry point: `@pierre/trees`

The root entry point is both the vanilla runtime entry and a shared type/helper
package.

### Runtime values

| Export                                         | Shape    | Notes                                                                                                                             |
| ---------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `FileTree`                                     | class    | Main imperative model/runtime. Construct with `new FileTree(options)`, then `render(...)` or `hydrate(...)`.                      |
| `preloadFileTree`                              | function | Server-side pre-render helper. Also re-exported from `@pierre/trees/ssr`.                                                         |
| `serializeFileTreeSsrPayload`                  | function | Reassembles an SSR payload into full host markup. Also re-exported from `@pierre/trees/ssr`.                                      |
| `prepareFileTreeInput`                         | function | Prepares raw paths with optional `flattenEmptyDirectories` and `sort`.                                                            |
| `preparePresortedFileTreeInput`                | function | Marks already-sorted input so the runtime can skip sorting and shaping work.                                                      |
| `themeToTreeStyles`                            | function | Maps a Shiki/VS Code-style theme object to host style values and `--trees-theme-*` CSS variables.                                 |
| `createFileTreeIconResolver`                   | function | Builds a resolver for built-in and remapped icon names.                                                                           |
| `getBuiltInFileIconColor`                      | function | Returns the CSS variable fallback chain for a built-in icon token string.                                                         |
| `getBuiltInSpriteSheet`                        | function | Returns SVG sprite markup for a built-in icon set or `'none'`.                                                                    |
| `FILE_TREE_DENSITY_PRESETS`                    | object   | `{ compact: { itemHeight: 24, factor: 0.8 }, default: { itemHeight: 30, factor: 1 }, relaxed: { itemHeight: 36, factor: 1.2 } }`. |
| `FILE_TREE_DEFAULT_ITEM_HEIGHT`                | number   | Default virtualized row height constant.                                                                                          |
| `FILE_TREE_TAG_NAME`                           | const    | `'file-tree-container'`.                                                                                                          |
| `FILE_TREE_STYLE_ATTRIBUTE`                    | const    | `'data-file-tree-style'`.                                                                                                         |
| `FILE_TREE_UNSAFE_CSS_ATTRIBUTE`               | const    | `'data-file-tree-unsafe-css'`.                                                                                                    |
| `FILE_TREE_SCROLLBAR_MEASURE_ATTRIBUTE`        | const    | `'data-file-tree-scrollbar-measure'`.                                                                                             |
| `FILE_TREE_SCROLLBAR_GUTTER_STYLE_ATTRIBUTE`   | const    | `'data-file-tree-scrollbar-gutter-measured'`.                                                                                     |
| `FILE_TREE_SCROLLBAR_GUTTER_MEASURED_PROPERTY` | const    | `'--trees-scrollbar-gutter-measured'`.                                                                                            |
| `FLATTENED_PREFIX`                             | const    | `'f::'`, used for flattened node IDs.                                                                                             |
| `HEADER_SLOT_NAME`                             | const    | `'header'`.                                                                                                                       |
| `CONTEXT_MENU_SLOT_NAME`                       | const    | `'context-menu'`.                                                                                                                 |
| `CONTEXT_MENU_TRIGGER_TYPE`                    | const    | `'context-menu-trigger'`.                                                                                                         |

### Root-exported types

Root types fall into these groups.

#### Input, sorting, and prepared input

| Type                       | Shape                                                        |
| -------------------------- | ------------------------------------------------------------ | ------ | -------- |
| `FileTreePreparedInput`    | Opaque-ish handle with a unique symbol and `readonly paths`. |
| `FileTreeSortEntry`        | `{ basename, depth, isDirectory, path, segments }`.          |
| `FileTreeSortComparator`   | `(left, right) => number`.                                   |
| `FileTreeInitialExpansion` | `'closed'                                                    | 'open' | number`. |

`FileTreeOptions` requires either `paths` or `preparedInput`. If both are
provided, `resolveFileTreeInput(...)` checks that the raw `paths` normalize/sort
to the same list as `preparedInput.paths`; otherwise it throws
`FileTree constructor received paths and preparedInput for different path lists`
or the corresponding `resetPaths` error.

#### Model options

`FileTreeOptions` is an intersection of input/controller behavior options and
render/appearance options.

| Option                    | Type                                         | Observed behavior                                                                                                                        |
| ------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `paths`                   | `readonly string[]`                          | Raw path list. Required unless `preparedInput` is present.                                                                               |
| `preparedInput`           | `FileTreePreparedInput`                      | Prepared path input. Required unless `paths` is present.                                                                                 |
| `flattenEmptyDirectories` | `boolean`                                    | Forwarded to the underlying path store. Also accepted by `prepareFileTreeInput`.                                                         |
| `initialExpansion`        | `'closed'                                    | 'open'                                                                                                                                   | number`                                                                                                       | Baseline expansion policy.                                |
| `initialExpandedPaths`    | `readonly string[]`                          | Paths to start expanded. Source/tests show both bare directory paths such as `src` and slash-suffixed paths such as `src/` are used.     |
| `presorted`               | `boolean`                                    | Exposed through `FileTreeOptions` via `FileTreeStoreOptions`; not exported as a standalone type from the root.                           |
| `sort`                    | `'default'                                   | FileTreeSortComparator`                                                                                                                  | Client-side ordering for raw or prepared input.                                                               |
| `dragAndDrop`             | `boolean                                     | FileTreeDragAndDropConfig`                                                                                                               | `true` enables with default config; `false`/`undefined` disables.                                             |
| `renaming`                | `boolean                                     | FileTreeRenamingConfig`                                                                                                                  | `true` enables inline rename without callbacks; config adds policy/callback hooks.                            |
| `fileTreeSearchMode`      | `'expand-matches'                            | 'collapse-non-matches'                                                                                                                   | 'hide-non-matches'`                                                                                           | Defaults to `'hide-non-matches'` in `FileTreeController`. |
| `initialSearchQuery`      | `string                                      | null`                                                                                                                                    | `null` means closed search; a string initializes search state.                                                |
| `initialSelectedPaths`    | `readonly string[]`                          | Seeds selection. The last selected path becomes the initial focus candidate.                                                             |
| `onSearchChange`          | `(value: string                              | null) => void`                                                                                                                           | Receives search value changes; `null` represents closed search.                                               |
| `composition`             | `FileTreeCompositionOptions`                 | Header and context-menu composition.                                                                                                     |
| `density`                 | `'compact'                                   | 'default'                                                                                                                                | 'relaxed'                                                                                                     | number`                                                   | Keyword resolves row height and factor; numeric factor keeps default row height unless `itemHeight` overrides it. |
| `gitStatus`               | `readonly GitStatusEntry[]`                  | Built-in Git-like status lane.                                                                                                           |
| `id`                      | `string`                                     | Host/model identity used by SSR/hydration and DOM id. Generated client ids use `pst_ft_#`; server ids use `pst_srv_#` when omitted.      |
| `icons`                   | `FileTreeBuiltInIconSet                      | FileTreeIconConfig`                                                                                                                      | Icon baseline, color mode, remaps, and sprite extension.                                                      |
| `onSelectionChange`       | `(selectedPaths: readonly string[]) => void` | Fires when selection version changes.                                                                                                    |
| `renderRowDecoration`     | `(context) => FileTreeRowDecoration          | null`                                                                                                                                    | Custom row signal lane.                                                                                       |
| `search`                  | `boolean`                                    | Controls whether the built-in search UI is rendered. The model search methods exist either way.                                          |
| `searchFakeFocus`         | `boolean`                                    | Renders a synthetic focus ring on the search input until real interaction. Source comments call this intended for demos/marketing pages. |
| `searchBlurBehavior`      | `'close'                                     | 'retain'`                                                                                                                                | Controls whether blur closes search or retains it. Source comments name `'close'` as default/legacy behavior. |
| `unsafeCSS`               | `string`                                     | Injected into the shadow root as a wrapped style block in the `unsafe` CSS layer.                                                        |
| `initialVisibleRowCount`  | `number`                                     | First-render/SSR row budget before viewport measurement. Fractional values are accepted.                                                 |
| `itemHeight`              | `number`                                     | Explicit virtualized row height. Overrides density preset row height.                                                                    |
| `overscan`                | `number`                                     | Extra rows outside the visible window.                                                                                                   |
| `stickyFolders`           | `boolean`                                    | Enables sticky folder rows in the render path.                                                                                           |

#### FileTree model methods

`FileTree` implements `FileTreeMutationHandle` and
`FileTreeSearchSessionHandle`.

Lifecycle and mounting:

| Method                         | Signature                                                                      | Notes                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------- |
| constructor                    | `new FileTree(options: FileTreeOptions)`                                       | Creates controller, resolves density, search UI flag, git state, composition, icon config. |
| `render`                       | `render({ containerWrapper?, fileTreeContainer? }: FileTreeRenderProps): void` | Mounts into an existing host or creates/appends a host into `containerWrapper`.            |
| `hydrate`                      | `hydrate({ fileTreeContainer }: FileTreeHydrationProps): void`                 | Attaches to existing SSR/declarative-shadow-DOM host markup.                               |
| `unmount`                      | `unmount(): void`                                                              | Unmounts runtime DOM but keeps model/controller available.                                 |
| `cleanUp`                      | `cleanUp(): void`                                                              | Calls `unmount`, removes selection subscription, and destroys the controller.              |
| `getFileTreeContainer`         | `(): HTMLElement                                                               | undefined`                                                                                 | Returns current host. |
| static `LoadedCustomComponent` | `boolean`                                                                      | Mirrors `FileTreeContainerLoaded`.                                                         |

Read APIs:

| Method                | Return                      |
| --------------------- | --------------------------- | ---------- |
| `getItem(path)`       | `FileTreeItemHandle         | null`      |
| `getFocusedItem()`    | `FileTreeItemHandle         | null`      |
| `getFocusedPath()`    | `string                     | null`      |
| `getSelectedPaths()`  | `readonly string[]`         |
| `getComposition()`    | `FileTreeCompositionOptions | undefined` |
| `getItemHeight()`     | `number`                    |
| `getDensityFactor()`  | `number`                    |
| `subscribe(listener)` | unsubscribe function        |

Focus, search, and rename controls:

| Method                     | Signature                                                              |
| -------------------------- | ---------------------------------------------------------------------- | --------------- | ----- |
| `focusPath`                | `(path: string) => void`                                               |
| `focusNearestPath`         | `(path: string                                                         | null) => string | null` |
| `setSearch`                | `(value: string                                                        | null) => void`  |
| `openSearch`               | `(initialValue?: string) => void`                                      |
| `closeSearch`              | `() => void`                                                           |
| `isSearchOpen`             | `() => boolean`                                                        |
| `getSearchValue`           | `() => string`                                                         |
| `getSearchMatchingPaths`   | `() => readonly string[]`                                              |
| `focusNextSearchMatch`     | `() => void`                                                           |
| `focusPreviousSearchMatch` | `() => void`                                                           |
| `startRenaming`            | `(path?: string, options?: { removeIfCanceled?: boolean }) => boolean` |

Mutation and runtime reconfiguration:

| Method           | Signature                                                                   |
| ---------------- | --------------------------------------------------------------------------- |
| `add`            | `(path: string) => void`                                                    |
| `remove`         | `(path: string, options?: FileTreeRemoveOptions) => void`                   |
| `move`           | `(fromPath: string, toPath: string, options?: FileTreeMoveOptions) => void` |
| `batch`          | `(operations: readonly FileTreeBatchOperation[]) => void`                   |
| `resetPaths`     | `(paths: readonly string[], options?: FileTreeResetOptions) => void`        |
| `onMutation`     | `(type, handler) => () => void`                                             |
| `setComposition` | `(composition?: FileTreeCompositionOptions) => void`                        |
| `setGitStatus`   | `(gitStatus?: FileTreeOptions['gitStatus']) => void`                        |
| `setIcons`       | `(icons?: FileTreeOptions['icons']) => void`                                |

`setComposition`, `setGitStatus`, and `setIcons` re-render in place when
mounted; otherwise they update model-held configuration for the next render.

#### Item handles

`getItem(path)` returns either a `FileTreeDirectoryHandle`, a
`FileTreeFileHandle`, or `null`.

Shared handle methods:

- `getPath(): string`
- `focus(): void`
- `select(): void`
- `toggleSelect(): void`
- `deselect(): void`
- `isFocused(): boolean`
- `isSelected(): boolean`
- `isDirectory(): boolean`

Directory-only methods:

- `expand(): void`
- `collapse(): void`
- `toggle(): void`
- `isExpanded(): boolean`
- `isDirectory(): true`

File handle refinement:

- `isDirectory(): false`

#### Mutation types

`FileTreeBatchOperation` variants:

```ts
{ type: 'add'; path: string }
{ type: 'remove'; path: string; recursive?: boolean }
{ type: 'move'; from: string; to: string; collision?: 'error' | 'replace' | 'skip' }
```

Mutation events share invalidation metadata:

```ts
{
  canonicalChanged: boolean;
  projectionChanged: boolean;
  visibleCountDelta: number | null;
}
```

Event variants:

| Event                 | Fields                                                                         |
| --------------------- | ------------------------------------------------------------------------------ |
| `FileTreeAddEvent`    | `operation: 'add'`, `path`                                                     |
| `FileTreeRemoveEvent` | `operation: 'remove'`, `path`, `recursive`                                     |
| `FileTreeMoveEvent`   | `operation: 'move'`, `from`, `to`                                              |
| `FileTreeResetEvent`  | `operation: 'reset'`, `pathCountBefore`, `pathCountAfter`, `usedPreparedInput` |
| `FileTreeBatchEvent`  | `operation: 'batch'`, `events: readonly FileTreeMutationSemanticEvent[]`       |

`FileTreeMutationEventForType<T>` narrows by operation, or returns all events
for `'*'`.

#### Rename types

| Type                     | Shape                                                                |
| ------------------------ | -------------------------------------------------------------------- |
| `FileTreeRenamingConfig` | `{ canRename?, onRename?, onError? }`                                |
| `FileTreeRenamingItem`   | `{ path: string; isFolder: boolean }`                                |
| `FileTreeRenameEvent`    | `{ sourcePath: string; destinationPath: string; isFolder: boolean }` |

Source code strips trailing slashes from directory paths before passing them to
rename policy/events, then re-adds slashes internally when committing the move.

#### Drag and drop types

| Type                        | Shape                                                                     |
| --------------------------- | ------------------------------------------------------------------------- | ----------------------------- | ---------------------------------- | ------------------------- | ------- |
| `FileTreeDragAndDropConfig` | `{ canDrag?, canDrop?, onDropComplete?, onDropError?, openOnDropDelay? }` |
| `FileTreeDropTarget`        | `{ kind: 'directory'                                                      | 'root'; directoryPath: string | null; flattenedSegmentPath: string | null; hoveredPath: string | null }` |
| `FileTreeDropContext`       | `{ draggedPaths: readonly string[]; target: FileTreeDropTarget }`         |
| `FileTreeDropResult`        | `FileTreeDropContext & { operation: 'batch'                               | 'move' }`                     |

Observed drag/drop behavior from source:

- Multi-select drag normalizes selected paths so a selected folder suppresses
  separately selected descendants.
- Drag starts are blocked while a search query is active.
- Dropping a single item reports `operation: 'move'`; multiple operations report
  `operation: 'batch'`.
- Self-or-descendant directory drops are rejected before `canDrop` result is
  committed.

#### Composition and context menu types

Root exports shorter aliases for several context-menu types:

| Root alias                    | Underlying type name in source        |
| ----------------------------- | ------------------------------------- |
| `ContextMenuItem`             | `FileTreeContextMenuItem`             |
| `ContextMenuOpenContext`      | `FileTreeContextMenuOpenContext`      |
| `ContextMenuTriggerMode`      | `FileTreeContextMenuTriggerMode`      |
| `ContextMenuButtonVisibility` | `FileTreeContextMenuButtonVisibility` |

Composition shapes:

```ts
interface FileTreeCompositionOptions {
  contextMenu?: FileTreeContextMenuCompositionOptions;
  header?: FileTreeHeaderCompositionOptions;
}

interface FileTreeHeaderCompositionOptions {
  html?: string;
  render?: () => HTMLElement | null;
}

type ContextMenuTriggerMode = 'both' | 'button' | 'right-click';
type ContextMenuButtonVisibility = 'always' | 'when-needed';

interface FileTreeContextMenuCompositionOptions {
  enabled?: boolean;
  triggerMode?: ContextMenuTriggerMode;
  buttonVisibility?: ContextMenuButtonVisibility;
  onOpen?: (item: ContextMenuItem, context: ContextMenuOpenContext) => void;
  onClose?: () => void;
  render?: (
    item: ContextMenuItem,
    context: ContextMenuOpenContext
  ) => HTMLElement | null;
}
```

Observed context-menu defaults from `FileTreeView`:

- Context menu is enabled if `enabled === true`, `render` exists, `onOpen`
  exists, or `onClose` exists.
- When enabled and `triggerMode` is omitted, the mode defaults to
  `'right-click'`.
- Button-capable modes are `'both'` and `'button'`.
- `buttonVisibility` defaults to `'when-needed'`.
- Portaled menu roots must be marked with
  `data-file-tree-context-menu-root="true"` so outside-click handling does not
  treat internal clicks as external.
- `ContextMenuOpenContext.close(options?)` accepts `{ restoreFocus?: boolean }`.

#### Row decoration and Git status types

Git status:

```ts
type GitStatus =
  | 'added'
  | 'deleted'
  | 'ignored'
  | 'modified'
  | 'renamed'
  | 'untracked';

interface GitStatusEntry {
  path: string;
  status: GitStatus;
}
```

Row decoration:

```ts
type FileTreeRowDecoration =
  | { text: string; title?: string }
  | { icon: RemappedIcon; title?: string };

type FileTreeRowDecorationRenderer = (
  context: FileTreeRowDecorationContext
) => FileTreeRowDecoration | null;
```

`FileTreeRowDecorationContext` provides both `item: ContextMenuItem` and
`row: FileTreeVisibleRow`.

#### Visible row type

`FileTreeVisibleRow` exposes:

- `path`, `name`, `kind`
- `index`, `depth`, `level`
- `ancestorPaths`
- `hasChildren`, `isExpanded`, `isFlattened`
- `isFocused`, `isSelected`
- ARIA placement helpers: `posInSet`, `setSize`
- optional `flattenedSegments`

This type is public because row decoration callbacks receive it.

### Prepared input helpers

```ts
prepareFileTreeInput(
  paths: readonly string[],
  options?: {
    flattenEmptyDirectories?: boolean;
    sort?: 'default' | FileTreeSortComparator;
  }
): FileTreePreparedInput

preparePresortedFileTreeInput(paths: readonly string[]): FileTreePreparedInput
```

`FileTreePreparedInput` includes `readonly paths`, but source comments and docs
describe it as opaque and not hand-rolled.

### SSR helpers and payload type

Root and `@pierre/trees/ssr` both export:

```ts
preloadFileTree(options: FileTreeOptions): FileTreeSsrPayload
serializeFileTreeSsrPayload(
  payload: FileTreeSsrPayload,
  mode?: 'declarative' | 'dom'
): string
```

`FileTreeSsrPayload` fields:

```ts
{
  domOuterStart: string;
  id: string;
  outerEnd: string;
  outerStart: string;
  shadowHtml: string;
}
```

Observed serializer behavior:

- default mode is `'declarative'`
- `'declarative'` uses `payload.outerStart`
- `'dom'` uses `payload.domOuterStart`
- both append `payload.shadowHtml` and `payload.outerEnd`

`preloadFileTree` emits density CSS variables inline on the host:

- `--trees-item-height:<resolved px>`
- `--trees-density-override:<resolved factor>`

### Icon API

Types:

```ts
type RemappedIcon =
  | string
  | { name: string; width?: number; height?: number; viewBox?: string };

type FileTreeBuiltInIconSet = 'minimal' | 'standard' | 'complete';

type FileTreeIcons = FileTreeBuiltInIconSet | FileTreeIconConfig;
```

`FileTreeIconConfig` fields:

| Field                                               | Meaning                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------- | ---------- | ------- | --------------------------------------------------------- |
| `set?: 'minimal'                                    | 'standard'                                                                      | 'complete' | 'none'` | Built-in set, or custom-only file mappings with `'none'`. |
| `colored?: boolean`                                 | Built-in semantic colors. Defaults to `true`.                                   |
| `spriteSheet?: string`                              | SVG string with `<symbol>` definitions injected into shadow DOM.                |
| `remap?: Record<string, RemappedIcon>`              | Built-in slot remaps.                                                           |
| `byFileName?: Record<string, RemappedIcon>`         | Exact basename remaps.                                                          |
| `byFileExtension?: Record<string, RemappedIcon>`    | Extension/suffix remaps without leading dot; multi-part suffixes are supported. |
| `byFileNameContains?: Record<string, RemappedIcon>` | Basename substring remaps.                                                      |

Observed defaults from `normalizeFileTreeIcons`:

- Omitted `icons` becomes `{ set: 'complete', colored: true }`.
- String `icons` becomes `{ set: icons, colored: true }`.
- Object `icons` defaults `colored` to `true`.
- Object `icons` defaults `set` to `'none'` if any custom overrides are present;
  otherwise it defaults to `'complete'`.

Built-in icon token union exists in `dist/builtInIcons.d.ts`, but the root entry
point does not export `BuiltInFileIconToken`. Root exports only
`getBuiltInFileIconColor(token: string)` and `getBuiltInSpriteSheet(set)`.

`createFileTreeIconResolver(icons?)` returns `{ resolveIcon(name, filePath?) }`.
Its generated declaration references `SVGSpriteNames`, whose source type is:

```ts
type SVGSpriteNames =
  | 'file-tree-icon-chevron'
  | 'file-tree-icon-file'
  | 'file-tree-icon-dot'
  | 'file-tree-icon-lock'
  | 'file-tree-icon-ellipsis';
```

The root entry point does not export `SVGSpriteNames`.

### Theming and styling API

`TreeThemeInput`:

```ts
{
  type?: 'light' | 'dark';
  bg?: string;
  fg?: string;
  colors?: Record<string, string>;
}
```

`TreeThemeStyles` is `Record<string, string>`.

`themeToTreeStyles(theme)` returns host-compatible style values and theme
variables. Observed output keys include:

- `colorScheme`
- `backgroundColor`
- `color`
- `borderColor`
- `--trees-theme-sidebar-bg`
- `--trees-theme-sidebar-fg`
- `--trees-theme-sidebar-header-fg`
- `--trees-theme-list-active-selection-fg`
- `--trees-theme-list-hover-bg`
- `--trees-theme-list-active-selection-bg`
- `--trees-theme-focus-ring`
- `--trees-theme-input-bg`
- optional `--trees-theme-sidebar-border`
- optional `--trees-theme-input-border`
- optional `--trees-theme-scrollbar-thumb`
- optional Git color variables: `--trees-theme-git-added-fg`,
  `--trees-theme-git-modified-fg`, `--trees-theme-git-deleted-fg`

### CSS variable surface

`style.css` states this fallback order:

1. explicit `--trees-*-override` variables
2. `--trees-theme-*` variables
3. library defaults

Observed explicit override families in the source comment:

Core color overrides:

- `--trees-fg-override`
- `--trees-fg-muted-override`
- `--trees-bg-override`
- `--trees-bg-muted-override`
- `--trees-accent-override`
- `--trees-border-color-override`

Focus overrides:

- `--trees-focus-ring-color-override`
- `--trees-focus-ring-width-override`
- `--trees-focus-ring-offset-override`

Search overrides:

- `--trees-search-fg-override`
- `--trees-search-font-weight-override`
- `--trees-search-bg-override`

Selection overrides:

- `--trees-selected-fg-override`
- `--trees-selected-bg-override`
- `--trees-selected-focused-border-color-override`

Git/status overrides:

- `--trees-status-added-override`
- `--trees-status-ignored-override`
- `--trees-status-modified-override`
- `--trees-status-renamed-override`
- `--trees-status-untracked-override`
- `--trees-status-deleted-override`
- `--trees-git-added-color-override`
- `--trees-git-ignored-color-override`
- `--trees-git-modified-color-override`
- `--trees-git-renamed-color-override`
- `--trees-git-untracked-color-override`
- `--trees-git-deleted-color-override`

Density and layout overrides:

- `--trees-density-override`
- `--trees-gap-override`
- `--trees-border-radius-override`
- `--trees-font-family-override`
- `--trees-font-size-override`
- `--trees-font-weight-regular-override`
- `--trees-font-weight-semibold-override`
- `--trees-level-gap-override`
- `--trees-item-padding-x-override`
- `--trees-item-margin-x-override`
- `--trees-item-row-gap-override`
- `--trees-icon-width-override`
- `--trees-icon-nudge-override`
- `--trees-scrollbar-gutter-override`
- `--trees-padding-inline-override`

Built-in icon color overrides include `--trees-file-icon-color` plus per-token
variables such as `--trees-file-icon-color-typescript`,
`--trees-file-icon-color-react`, `--trees-file-icon-color-json`, and the rest of
the built-in token names.

### DOM-facing surface

Observed custom element and slots:

- Host tag: `<file-tree-container>`.
- Header slot name: `header`.
- Context-menu slot name: `context-menu`.
- The React component renders directly to this host and accepts normal host HTML
  attributes except `children`.
- Vanilla callers can render into an existing `fileTreeContainer` host or ask
  `FileTree.render` to create one inside `containerWrapper`.
- SSR output serializes this host plus its shadow-root content.

Observed data attributes and selectors that external CSS or tests may notice:

| Surface            | Observed marker                                                                    | Notes                                                                                |
| ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Host               | `file-tree-container`                                                              | Public custom element tag.                                                           |
| Style tag          | `style[data-file-tree-style]`                                                      | Fallback when constructable stylesheets are unavailable.                             |
| Unsafe style tag   | `style[data-file-tree-unsafe-css]`                                                 | Injected when `unsafeCSS` is provided.                                               |
| Search container   | `data-file-tree-search-container` and `data-open`                                  | Used by docs demo CSS to hide a closed search input.                                 |
| Scrollbar measure  | `data-file-tree-scrollbar-measure`                                                 | Internal measurement node/attribute exported as a constant.                          |
| Scrollbar gutter   | `data-file-tree-scrollbar-gutter-measured` and `--trees-scrollbar-gutter-measured` | Measurement result is reflected into host styles.                                    |
| Row root           | row elements with item path/state attributes                                       | Row decorators, Git status, selection, and context menus all depend on row identity. |
| Item button        | `button[data-type="item"]`                                                         | Actual item button selector observed in render code/CSS.                             |
| Focused item       | `data-item-focused`                                                                | Used by styling.                                                                     |
| Context menu roots | `data-file-tree-context-menu-root="true"`                                          | Required on external/portaled menu roots so outside-click handling keeps them open.  |

The package also exposes `src/react/jsx.d.ts` so TypeScript recognizes
`<file-tree-container>` JSX usage after the package types are loaded.

## React entry point: `@pierre/trees/react`

Runtime exports:

| Export                 | Shape           | Notes                                                                   |
| ---------------------- | --------------- | ----------------------------------------------------------------------- |
| `FileTree`             | React component | Renders/hydrates a caller-owned `FileTree` model.                       |
| `useFileTree`          | hook            | Constructs a stable `FileTree` model once and cleans it up on unmount.  |
| `useFileTreeSelector`  | hook            | Subscribes to a selected model snapshot through `useSyncExternalStore`. |
| `useFileTreeSelection` | hook            | Convenience selector for selected paths.                                |
| `useFileTreeSearch`    | hook            | Convenience wrapper around model search state and actions.              |

React-exported types:

| Type                          | Shape                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | --------------- |
| `FileTreeProps`               | Host HTML attributes except `children`, plus `model`, `header`, `preloadedData`, and `renderContextMenu`. |
| `FileTreePreloadedData`       | `Pick<FileTreeSsrPayload, 'id'                                                                            | 'shadowHtml'>`. |
| `UseFileTreeResult`           | alias for the core `FileTree` class.                                                                      |
| `FileTreeSelector<T>`         | `(tree: FileTree) => T`.                                                                                  |
| `FileTreeSelectorEquality<T>` | `(left: T, right: T) => boolean`.                                                                         |
| `FileTreeSearchState`         | `{ isOpen, value, matchingPaths, open, close, setValue, focusNextMatch, focusPreviousMatch }`.            |

### React component props

```ts
interface FileTreeProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  'children'
> {
  model: FileTreeModel;
  header?: React.ReactNode;
  preloadedData?: Pick<FileTreeSsrPayload, 'id' | 'shadowHtml'>;
  renderContextMenu?: (
    item: ContextMenuItem,
    context: ContextMenuOpenContext
  ) => React.ReactNode;
}
```

Observed component behavior:

- `model` is required and caller-owned.
- `header` renders into the package header slot. When present, the component
  removes `composition.header` from the model composition passed to the
  underlying render layer.
- `renderContextMenu` renders into the package context-menu slot. When present,
  the component wraps any model `onOpen`/`onClose` callbacks and removes
  `composition.contextMenu.render` from the composition passed to the underlying
  render layer.
- `preloadedData` hydrates existing SSR shadow markup when a matching host is
  present; otherwise the component renders normally.
- The host id is `props.id ?? preloadedData?.id`.
- The component writes resolved density CSS variables into the host style, then
  spreads caller `style` afterward, so caller style can override those
  variables.

### React hooks

`useFileTree(options)` creates `new FileTree(options)` once via a ref. Later
React prop/state changes to `options` are not replayed into the model; callers
must call model methods such as `resetPaths`, `setGitStatus`, `setIcons`,
`setComposition`, or remount with a new key when structural options change.

`useFileTreeSelector(model, selector, equality?)` subscribes through
`model.subscribe` and returns the selected snapshot. The generated declaration
for `useFileTreeSelector.d.ts` also exports `areArraysEqual`, but
`react/index.ts` does not re-export that helper from `@pierre/trees/react`.

`useFileTreeSelection(model)` returns the selected path array and uses array
equality to avoid updates when the same selected paths are emitted.

`useFileTreeSearch(model)` returns the current search session state plus stable
actions that delegate to model methods.

## SSR entry point: `@pierre/trees/ssr`

`@pierre/trees/ssr` exports the same SSR helpers and payload type as the root
entry point:

```ts
preloadFileTree(options: FileTreeOptions): FileTreeSsrPayload;
serializeFileTreeSsrPayload(
  payload: FileTreeSsrPayload,
  mode?: 'declarative' | 'dom'
): string;
type FileTreeSsrPayload = {
  domOuterStart: string;
  id: string;
  outerEnd: string;
  outerStart: string;
  shadowHtml: string;
};
```

Observed SSR contract:

- Server and client must use compatible model options so hydration sees the same
  tree shape, ids, density, and search/header/menu configuration.
- `preloadFileTree` returns shadow HTML separately from host start/end markup so
  frameworks can either inject a full string or hand only `{ id, shadowHtml }`
  to the React component.
- React only needs `id` and `shadowHtml`; vanilla examples use the full
  serialized host markup.

## Web-components entry point: `@pierre/trees/web-components`

Runtime exports:

| Export                      | Shape     | Notes                                                                                                                             |
| --------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `FileTreeContainerLoaded`   | `boolean` | `true` after this module is loaded. `FileTree.LoadedCustomComponent` mirrors it.                                                  |
| `adoptDeclarativeShadowDom` | function  | Moves declarative shadow DOM template content into an actual shadow root.                                                         |
| `ensureFileTreeStyles`      | function  | Installs package styles into a shadow root with adopted stylesheets when supported, otherwise with `style[data-file-tree-style]`. |
| `prepareFileTreeShadowRoot` | function  | Runs declarative-shadow adoption, style installation, and scrollbar gutter measurement.                                           |

Importing this entry point also registers `<file-tree-container>` when
`HTMLElement` exists and `customElements.get('file-tree-container')` is empty.
The registered element attaches an open shadow root on connect and prepares it
with `prepareFileTreeShadowRoot`.

## Generated declarations that look public but are not package exports

The build emits declaration files for many source modules under
`packages/trees/dist/**`, including `dist/model/*`, `dist/render/*`,
`dist/utils/*`, and `dist/react/useFileTreeSelector.d.ts`. The package `exports`
map exposes only `.`, `./react`, `./ssr`, and `./web-components`.

`package.json` also contains:

```json
"typesVersions": {
  "*": {
    "*": ["dist/*"]
  }
}
```

That means the package has more generated type surface than the explicit runtime
export map. For the audit, the importable contract is the export map; the extra
declarations are still worth noticing because editor resolution, agents, or
users inspecting published files may discover them.
