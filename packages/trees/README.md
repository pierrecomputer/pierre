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
  shadowHtml: string;
  html: string;
}
```

Use `payload.html` when you want a full `<file-tree-container>` string, or pass
`{ id, shadowHtml }` to the React component as `preloadedData`.

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

Header and context-menu composition are configured through the tree options.
Rows, search state, drag/drop targets, and mutation events all report canonical
paths.

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
