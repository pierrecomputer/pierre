# @pierre/trees external usage patterns audit

This file inventories the ways the current repo teaches, demonstrates, or
implicitly supports using `@pierre/trees`. It is descriptive, not a migration
plan.

## Scope and sources

Observed examples and docs:

- `packages/trees/README.md`
- `apps/docs/app/trees/docs/**/content.mdx`
- `apps/docs/app/trees/docs/**/constants.ts`
- `apps/docs/app/trees/DemoSearch*.tsx`
- `apps/docs/components/TreeApp.tsx`
- `apps/docs/app/trees-dev/_demos/*.tsx`
- `apps/docs/app/trees-dev/search/page.tsx`
- `apps/docs/lib/treesCompat*.ts(x)`
- `apps/docs/lib/fileTreePathOptions.ts`

## High-level integration choices

| Integration                   | What users are shown doing                                                                                                                                              | Typical import                                                                            | Observed examples                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| React                         | Create a stable model with `useFileTree`, render `<FileTree model={model} />`, then subscribe with hooks or call model methods.                                         | `@pierre/trees/react` plus shared types/helpers from `@pierre/trees`                      | `GetStartedWithReact`, `ReactAPI`, `DemoTreeAppClient`, `DensityDemoClient`, `SearchDemoClient`         |
| Vanilla/browser               | Construct `new FileTree(options)`, keep a model reference, and call `render`, `hydrate`, `resetPaths`, `setGitStatus`, `setIcons`, mutation methods, or search methods. | `@pierre/trees`                                                                           | `GetStartedWithVanilla`, `VanillaAPI`, `MainDemoClient`, `DragAndDropDemoClient`, `GitStatusDemoClient` |
| SSR                           | Server calls `preloadFileTree(options)`, emits the payload, and the client hydrates with matching options.                                                              | `@pierre/trees/ssr` on the server; `@pierre/trees/react` or `@pierre/trees` on the client | `SSR` guide, `SSRAPI`, README, `DensityDemoClient`, `MainDemoClient`                                    |
| Web component support         | Import the web-components entry for registration or rely on the core render path importing it.                                                                          | `@pierre/trees/web-components`                                                            | Reference docs and custom-element declarations                                                          |
| Docs/demo compatibility layer | Use older or docs-specific prop names that are adapted to the package model.                                                                                            | `apps/docs/lib/treesCompat*` internal imports                                             | `Overview` and demo code paths                                                                          |

## Common data-shaping pattern

The docs and demos strongly prefer preparing input before constructing the model
for non-trivial trees.

### Small/static tree

Observed pattern:

```ts
const model = useFileTree({
  paths: ['src/index.ts', 'src/components/Button.tsx'],
  search: true,
});
```

This appears mainly in examples where clarity matters more than performance.

### Prepared tree

Observed pattern:

```ts
const preparedInput = prepareFileTreeInput(paths, {
  flattenEmptyDirectories: true,
  sort: 'default',
});

const model = useFileTree({
  preparedInput,
  search: true,
  initialExpandedPaths: ['src', 'src/components'],
});
```

This is the main path in docs that discuss larger trees. The package treats
`FileTreePreparedInput` as a value produced by package helpers, not as a
hand-authored structure.

### Presorted prepared tree

Observed pattern:

```ts
const preparedInput = preparePresortedFileTreeInput(serverOrderedPaths);

const model = new FileTree({
  paths: serverOrderedPaths,
  preparedInput,
  presorted: true,
});
```

The tree-dev helpers also wrap `preparePresortedFileTreeInput` in a local helper
named `createPresortedPreparedInput`. This pattern is used when another system
already owns ordering and the tree should skip sorting work.

### `paths` plus `preparedInput`

Several examples pass both raw `paths` and `preparedInput`. Source validates
that they describe the same normalized path list. This means the external
pattern is not simply "prepared input replaces paths"; consumers may see both
values carried together so the model can keep a raw list while avoiding repeated
preparation.

## React model lifecycle pattern

Observed React pattern:

```tsx
const model = useFileTree({
  preparedInput,
  search: true,
  initialExpandedPaths: ['src'],
});

return <FileTree model={model} className="Tree" />;
```

Important implied contract: `useFileTree(options)` constructs the model once.
Later React renders do not re-apply changed options. Docs and demos handle
runtime changes in three ways:

1. Call explicit model methods for dynamic state:
   - `resetPaths(nextPaths, options)`
   - `setGitStatus(nextStatuses)`
   - `setIcons(nextIcons)`
   - `setComposition(nextComposition)`
   - `setSearch(value)` / `openSearch()` / `closeSearch()`
2. Subscribe through hooks for model state:
   - `useFileTreeSelection(model)`
   - `useFileTreeSearch(model)`
   - `useFileTreeSelector(model, selector, equality?)`
3. Remount the React tree/model with a changed `key` when structural
   construction options should be rebuilt. `DensityDemoClient` and
   `ItemCustomizationDemoClient` both demonstrate key-based remounts for some
   controls.

The React component owns rendering only; callers still own the `FileTree` model
object.

## Vanilla lifecycle pattern

Observed vanilla pattern:

```ts
const tree = new FileTree({
  preparedInput,
  search: true,
  dragAndDrop: true,
  renaming: true,
});

tree.render({ containerWrapper });

return () => tree.cleanUp();
```

Observed variants:

- `render({ fileTreeContainer })` when the host already exists.
- `render({ containerWrapper })` when the package should create and append the
  host.
- `hydrate({ fileTreeContainer })` when SSR markup already exists.
- `unmount()` when DOM should detach but the model may remain useful.
- `cleanUp()` for final teardown.

Examples keep the model in a ref or closure, then call model methods in response
to UI controls.

## SSR and hydration pattern

Observed server pattern:

```ts
import {
  preloadFileTree,
  serializeFileTreeSsrPayload,
} from '@pierre/trees/ssr';

const payload = preloadFileTree({
  preparedInput,
  id: 'docs-tree',
  search: true,
});

const html = serializeFileTreeSsrPayload(payload);
```

Observed React client pattern:

```tsx
const model = useFileTree({
  preparedInput,
  id: preloadedData.id,
  search: true,
});

return <FileTree model={model} preloadedData={preloadedData} />;
```

Observed vanilla client pattern:

```ts
const existing = container.querySelector('file-tree-container');
if (existing) {
  tree.hydrate({ fileTreeContainer: existing });
} else {
  tree.render({ containerWrapper: container });
}
```

Implied external contract:

- Server and client options should match for tree shape and
  presentation-affecting configuration.
- The `id` connects server output to client hydration.
- The SSR payload has documented fields, but docs also tell users to treat it as
  package-generated data.
- Demos sometimes serialize a complete host string and sometimes pass only
  `{ id, shadowHtml }` into React.

## Selection and focus pattern

Observed patterns:

```ts
const selectedPaths = useFileTreeSelection(model);
```

```ts
const focused = model.getFocusedPath();
model.focusPath('src/index.ts');
model.focusNearestPath(pathOrNull);
```

Selection enters the external API through:

- `initialSelectedPaths`
- `onSelectionChange`
- `getSelectedPaths()`
- item handle methods: `select`, `toggleSelect`, `deselect`, `isSelected`
- React `useFileTreeSelection`

Focus enters through:

- `focusPath`
- `focusNearestPath`
- `getFocusedPath`
- `getFocusedItem`
- item handle `focus` and `isFocused`
- keyboard/search interactions managed by the tree

Docs and demos generally use paths as the user-visible identity for both
selection and focus.

## Search pattern

Observed built-in search pattern:

```ts
const model = useFileTree({
  preparedInput,
  search: true,
  fileTreeSearchMode: 'hide-non-matches',
});
```

Observed external/search-toolbar pattern:

```ts
const search = useFileTreeSearch(model);

<input
  value={search.value}
  onChange={(event) => search.setValue(event.currentTarget.value)}
/>
```

Observed programmatic search pattern:

```ts
const model = useFileTree({
  preparedInput,
  search: false,
});

model.openSearch('router');
model.focusNextSearchMatch();
model.closeSearch();
```

Important distinction: the `search` option controls the built-in input UI. The
model search session and methods exist even when `search: false`.

Observed search modes:

- `'hide-non-matches'`
- `'collapse-non-matches'`
- `'expand-matches'`

Observed demo-only or presentation-focused search options:

- `initialSearchQuery`
- `searchBlurBehavior`
- `searchFakeFocus`

`apps/docs/components/TreeApp.tsx` also has a docs wrapper prop named
`searchEnabled`, with a comment that it must match a model constructed with
`search: true`.

## Mutation pattern

Observed imperative mutations:

```ts
tree.add('src/new-file.ts');
tree.move('src/old.ts', 'src/new.ts');
tree.remove('src/new.ts');
tree.batch([
  { type: 'add', path: 'src/a.ts' },
  { type: 'move', from: 'src/a.ts', to: 'src/b.ts' },
]);
```

Observed reset pattern:

```ts
tree.resetPaths(nextPaths, {
  initialExpandedPaths: ['src'],
  preparedInput: preparePresortedFileTreeInput(nextPaths),
});
```

Observed mutation subscription pattern:

```ts
const unsubscribe = tree.onMutation('*', (event) => {
  // inspect event.operation and invalidation metadata
});
```

Demos use mutation subscriptions to log operations and keep surrounding UI in
sync. The external event model includes add, remove, move, reset, and batch
events.

## Rename pattern

Observed basic enablement:

```ts
const model = useFileTree({
  preparedInput,
  renaming: true,
});
```

Observed configured rename:

```ts
const model = useFileTree({
  preparedInput,
  renaming: {
    canRename(item) {
      return !item.path.includes('/vendor/');
    },
    onRename(event) {
      persistRename(event.sourcePath, event.destinationPath);
    },
    onError(error, event) {
      reportRenameFailure(error, event);
    },
  },
});
```

Observed action trigger:

```ts
model.startRenaming(item.path);
```

Docs and demos commonly invoke rename from a context menu action.
`apps/docs/components/TreeApp.tsx` notes that the caller must construct the
model with `renaming: true` or a rename config for rename menu actions to work.

## Drag-and-drop pattern

Observed basic enablement:

```ts
const model = useFileTree({
  preparedInput,
  dragAndDrop: true,
});
```

Observed configured drag/drop:

```ts
const model = new FileTree({
  preparedInput,
  dragAndDrop: {
    canDrag(paths) {
      return paths.every((path) => !path.startsWith('locked/'));
    },
    canDrop(context) {
      return context.target.kind === 'directory';
    },
    onDropComplete(result) {
      persistMove(result);
    },
    onDropError(error, context) {
      reportDropFailure(error, context);
    },
    openOnDropDelay: 500,
  },
});
```

Observed model behavior exposed to users through examples:

- Dragging is blocked while search is active.
- Dropping into folders can auto-open them after `openOnDropDelay`.
- The package mutates its model first, then reports `onDropComplete` with
  `operation: 'move'` or `operation: 'batch'`.

## Context menu and header composition pattern

Observed model composition pattern:

```ts
const model = useFileTree({
  preparedInput,
  composition: {
    header: {
      html: '<div slot="header">Files</div>',
    },
    contextMenu: {
      enabled: true,
      triggerMode: 'both',
      buttonVisibility: 'when-needed',
      onOpen(item, context) {},
      onClose() {},
      render(item, context) {
        return menuElement;
      },
    },
  },
});
```

Observed React override pattern:

```tsx
<FileTree
  model={model}
  header={<Toolbar />}
  renderContextMenu={(item, context) => (
    <Menu
      onRename={() => model.startRenaming(item.path)}
      onClose={context.close}
    />
  )}
/>
```

Observed vanilla slot/render pattern:

- Use `composition.header.html` for static header markup.
- Use `composition.header.render` for an element factory.
- Use `composition.contextMenu.render` to return a menu element.
- Mark portaled menu roots with `data-file-tree-context-menu-root="true"` when
  clicks inside that root should not close the menu.

Observed trigger modes:

- `'right-click'`
- `'button'`
- `'both'`

Observed button visibility values:

- `'always'`
- `'when-needed'`

## Git status and row decoration pattern

Observed Git status pattern:

```ts
const statuses = [
  { path: 'src/index.ts', status: 'modified' },
  { path: 'src/generated/', status: 'ignored' },
] as const;

const model = useFileTree({
  preparedInput,
  gitStatus: statuses,
});

model.setGitStatus(nextStatuses);
model.setGitStatus(undefined);
```

Observed row decoration pattern:

```ts
const model = useFileTree({
  preparedInput,
  renderRowDecoration({ item, row }) {
    if (row.kind === 'directory') return null;
    return { text: 'API', title: item.path };
  },
});
```

Git statuses and row decorations both create extra row-level visual signals.
Examples use Git status for package-known status values and row decoration for
domain-specific labels or icons.

## Icons pattern

Observed default pattern:

```ts
const model = useFileTree({
  preparedInput,
  icons: 'complete',
});
```

Observed custom sprite/remap pattern:

```ts
const model = useFileTree({
  preparedInput,
  icons: {
    set: 'complete',
    colored: true,
    spriteSheet: customSymbols,
    byFileExtension: {
      mdx: 'file-tree-icon-markdown',
    },
    byFileName: {
      'package.json': { name: 'file-tree-icon-package', width: 16, height: 16 },
    },
  },
});
```

Observed external icon helper usage:

```ts
const resolver = createFileTreeIconResolver(icons);
const resolved = resolver.resolveIcon(
  'package.json',
  'packages/trees/package.json'
);
const color = getBuiltInFileIconColor('typescript');
const sprite = getBuiltInSpriteSheet('complete');
```

Docs and demos use icon helpers outside the tree to render legends or previews
that match the tree's internal icon resolution.

## Styling, theming, and density pattern

Observed host style pattern:

```tsx
<FileTree
  model={model}
  style={{
    height: 420,
    '--trees-bg-override': '#0f172a',
    '--trees-selected-bg-override': '#1d4ed8',
  }}
/>
```

Observed theme helper pattern:

```ts
const styles = themeToTreeStyles(theme);

<FileTree model={model} style={styles} />;
```

Observed density pattern:

```ts
const model = useFileTree({
  preparedInput,
  density: 'compact',
});
```

Observed custom density/height pattern:

```ts
const model = useFileTree({
  preparedInput,
  density: 0.9,
  itemHeight: 28,
});
```

Observed unsafe CSS pattern:

```ts
const model = useFileTree({
  preparedInput,
  unsafeCSS: `
    :host { --trees-item-padding-x-override: 6px; }
    button[data-type="item"] { font-variant-numeric: tabular-nums; }
  `,
});
```

Docs present normal CSS variables as the main styling API and `unsafeCSS` as an
escape hatch for shadow DOM internals.

## Docs/demo wrapper patterns that are not the package API

The docs app contains compatibility and application-level wrappers. These are
not exported from `@pierre/trees`, but they shape examples and may influence
what agents or maintainers think the library supports.

### `apps/docs/lib/treesCompat*.ts(x)`

The compatibility wrapper accepts names such as:

- `files`
- `initialFiles`
- `initialExpandedItems`
- `initialSelectedItems`
- `selectedItems`
- `onFilesChange`
- `onSelection`
- `prerenderedHTML`
- `options.virtualize`
- `options.lockedPaths`
- `options.onCollision`
- `options.useLazyDataLoader`

It maps these to the package's `paths`, `initialExpandedPaths`,
`initialSelectedPaths`, model methods, and SSR/hydration fields. The `Overview`
docs page uses this wrapper rather than direct package imports.

### `apps/docs/components/TreeApp.tsx`

`TreeApp` is an application shell around a caller-owned package model. Its props
expose app-level concerns such as file previewing, navigation, logs, toolbar
controls, and context-menu labels. It also carries comments that bind wrapper
props to model construction options, especially for search and rename.

## First-principles usage contracts surfaced by the code

These are not always phrased as docs rules, but external callers depend on them
once they use the public API.

1. Paths are the main identity token for files, directories, selection, focus,
   mutations, search matches, rename, drag/drop, Git status, and decorations.
2. Directory paths are accepted in both bare and slash-suffixed forms in some
   APIs, but some outputs and status entries preserve or require a trailing
   slash.
3. Rendering assumes the host has a bounded height or lives in a layout that
   produces one; examples usually set an explicit height.
4. The model is stateful. React is a view layer over that model, not the owner
   of all state transitions.
5. SSR hydration requires shape-compatible server and client options.
6. Prepared input and icon configuration are package-produced or
   package-normalized structures, even when some fields are visible.
7. Styling is split across host CSS variables, `themeToTreeStyles`,
   density/item-height options, shadow DOM data attributes, and optional
   `unsafeCSS`.
