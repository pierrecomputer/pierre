# @pierre/trees

Path-first file tree UI for the web.

`@pierre/trees` ships one implementation with three public entry points:

- `@pierre/trees` — imperative model + vanilla mounting API
- `@pierre/trees/react` — React hooks and `<FileTree model={...} />`
- `@pierre/trees/ssr` — declarative-shadow-DOM preload helper

The tree renders inside a shadow root, uses CSS custom properties for theming,
and keeps its public API keyed by canonical paths instead of internal numeric
IDs.

## Install

```bash
bun add @pierre/trees
```

## Vanilla usage

```ts
import { FileTree } from '@pierre/trees';

const tree = new FileTree({
  flattenEmptyDirectories: true,
  initialExpansion: 'open',
  paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
  search: true,
  viewportHeight: 320,
});

tree.render({ containerWrapper: document.getElementById('mount')! });
```

Useful model methods:

- `tree.add(path)`
- `tree.move(fromPath, toPath)`
- `tree.remove(path)`
- `tree.resetPaths(paths)`
- `tree.setSearch(value)` / `tree.openSearch()` / `tree.closeSearch()`
- `tree.setGitStatus(entries)`
- `tree.setIcons(config)`
- `tree.getItem(path)` / `tree.getSelectedPaths()` / `tree.getFocusedPath()`
- `tree.cleanUp()`

## Prepared input

For large or frequently reloaded trees, prepare the input once outside the UI
and pass the prepared result into `FileTree`.

```ts
import { FileTree, preparePresortedFileTreeInput } from '@pierre/trees';

const paths = ['src/', 'src/index.ts', 'README.md'];
const preparedInput = preparePresortedFileTreeInput(paths);

const tree = new FileTree({
  preparedInput,
  viewportHeight: 320,
});
```

Use `prepareFileTreeInput(paths)` when you start with raw input. Use
`preparePresortedFileTreeInput(paths)` when the final order is already known.

## React usage

```tsx
'use client';

import { FileTree, useFileTree } from '@pierre/trees/react';

export function Example({ paths }: { paths: string[] }) {
  const { model } = useFileTree({
    initialExpansion: 'open',
    paths,
    search: true,
    viewportHeight: 320,
  });

  return (
    <FileTree
      model={model}
      header={<strong>Project files</strong>}
      renderContextMenu={(item) => <div>Menu for {item.path}</div>}
      style={{ height: '320px' }}
    />
  );
}
```

Available hooks from `@pierre/trees/react`:

- `useFileTree(options)`
- `useFileTreeSearch(model)`
- `useFileTreeSelection(model)`
- `useFileTreeSelector(model, selector)`

## SSR

```tsx
import { preloadFileTree } from '@pierre/trees/ssr';
import { FileTree, useFileTree } from '@pierre/trees/react';

const preloadedData = preloadFileTree({
  id: 'docs-tree',
  initialExpansion: 'open',
  paths: ['README.md', 'src/index.ts'],
  viewportHeight: 240,
});

export function HydratedTree() {
  const { model } = useFileTree({
    id: 'docs-tree',
    initialExpansion: 'open',
    paths: ['README.md', 'src/index.ts'],
    viewportHeight: 240,
  });

  return <FileTree model={model} preloadedData={preloadedData} />;
}
```

`preloadFileTree()` returns:

```ts
{
  id: string;
  outerStart: string;
  domOuterStart: string;
  shadowHtml: string;
  outerEnd: string;
}
```

Use `${payload.outerStart}${payload.shadowHtml}${payload.outerEnd}` when the
HTML parser will see the markup directly, such as a full server-rendered HTML
response. Use `${payload.domOuterStart}${payload.shadowHtml}${payload.outerEnd}`
when you need to insert the full container string through DOM APIs like
`innerHTML` or `dangerouslySetInnerHTML`. Pass `{ id, shadowHtml }` to the React
component as `preloadedData`.

## Styling

The host element and shadow root read CSS variables such as:

- `--trees-selected-bg-override`
- `--trees-border-color-override`
- `--trees-fg-override`
- `--trees-theme-*`

You can translate a Shiki / VS Code style theme into tree CSS with
`themeToTreeStyles()`:

```ts
import { themeToTreeStyles } from '@pierre/trees';

const styles = themeToTreeStyles(theme);
```

If CSS variables are not enough, `unsafeCSS` injects raw CSS into the tree
shadow root:

```ts
const tree = new FileTree({
  paths,
  unsafeCSS: `
    button[data-type='item'][data-item-selected] {
      border-radius: 999px;
    }
  `,
});
```

Treat `unsafeCSS` as an escape hatch. Start with host styles, CSS variables, and
`themeToTreeStyles()` first.

If you need the custom element registration side effect directly, import:

```ts
import '@pierre/trees/web-components';
```

## Icons, git status, and composition

The root package exports the icon and git-status types used by the tree model,
including:

- `FileTreeIcons`
- `FileTreeIconConfig`
- `GitStatusEntry`
- `ContextMenuItem`
- `ContextMenuOpenContext`
- `ContextMenuTriggerMode`
- `ContextMenuButtonVisibility`

Header and context-menu composition are configured through the tree options.
Rows, search state, drag/drop targets, and mutation events all report canonical
paths.

```ts
const tree = new FileTree({
  composition: {
    contextMenu: {
      enabled: true,
    },
  },
  paths,
});
```

When the context menu is enabled without an explicit `triggerMode`, it defaults
to `'right-click'`. Set `triggerMode: 'button'` or `triggerMode: 'both'` when
you want the dedicated right-side action lane. In those button-capable modes,
`buttonVisibility` defaults to `'when-needed'`; set it to `'always'` to show
decorative per-row affordances while the tree still uses one real floating
trigger button and one slotted menu surface.

`renderRowDecoration` now occupies its own flexible lane. Built-in git status
rendering stays separate in the next fixed lane, so custom decoration content,
git status, and the context-menu affordance can appear on the same row without
overriding each other.

## Development

From `packages/trees`:

```bash
bun test
bun run test:e2e
bun run benchmark
bun run benchmark:file-tree-get-item
bun run profile:file-tree
bun run tsc
bun run build
```
