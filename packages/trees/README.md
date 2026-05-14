# @pierre/trees

Path-first file tree UI for the web.

`@pierre/trees` ships one implementation through four public entry points:

- `@pierre/trees` — vanilla model, mounting API, prepared input helpers, icons,
  theming, and core types
- `@pierre/trees/react` — React hooks and `<FileTree model={...} />`
- `@pierre/trees/ssr` — preload helpers for declarative-shadow-DOM SSR
- `@pierre/trees/web-components` — custom-element registration side effect

The tree renders inside a shadow root and keeps public state keyed by canonical
path strings, not internal numeric IDs.

## Install

```bash
bun add @pierre/trees
```

## Vanilla usage

```ts
import { FileTree } from '@pierre/trees';

const mount = document.getElementById('mount')!;
mount.style.height = '320px';

const tree = new FileTree({
  flattenEmptyDirectories: true,
  initialExpansion: 'open',
  paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
  search: true,
});

tree.render({ containerWrapper: mount });
```

Common model methods include:

- `tree.add(path)`, `tree.move(fromPath, toPath)`, `tree.remove(path)`, and
  `tree.resetPaths(paths)`
- `tree.openSearch()`, `tree.setSearch(value)`, and `tree.closeSearch()`
- `tree.setGitStatus(entries)` and `tree.setIcons(config)`
- `tree.getItem(path)`, `tree.getSelectedPaths()`, and `tree.getFocusedPath()`
- `tree.cleanUp()`

## Prepared input

Prepare large or frequently reloaded path lists once, then pass the prepared
result to `FileTree`.

```ts
import { FileTree, preparePresortedFileTreeInput } from '@pierre/trees';

const paths = ['src/', 'src/index.ts', 'README.md'];
const preparedInput = preparePresortedFileTreeInput(paths);

const tree = new FileTree({ preparedInput });
```

Use `prepareFileTreeInput(paths)` for raw input. Use
`preparePresortedFileTreeInput(paths)` when the final order is already known.

## External scroll containers

Import from `@pierre/trees/scroll` when a caller-owned scroller contains content
above and below the tree. The tree remains a normal block in that scroller and
owns only its virtual spacer height.

```ts
import { FileTree, createDomScrollSource } from '@pierre/trees/scroll';

const source = createDomScrollSource({
  scrollContainer: parentScroller,
  topInset: () => toolbar.getBoundingClientRect().height,
});

const tree = new FileTree({
  paths,
  stickyFolders: true,
  externalScroll: {
    initialSnapshot: source.getSnapshot(),
    source,
  },
});

tree.render({ containerWrapper: mount });
const host = tree.getFileTreeContainer();
source.setHost(host ?? null);
```

`createDomScrollSource()` handles the common DOM-scroller case. If you roll your
own source, it reports host-local metrics: `viewportTop`, `viewportHeight`,
`topInset`, `bottomInset`, `isScrolling`, and `scrollOrigin`. Its
`scrollToViewportTop(nextTop, context)` method must update `getSnapshot()`
synchronously before returning. `initialVisibleRowCount` is only a fallback in
external mode when `initialSnapshot` is missing.

Header and search UI scroll with the tree in external mode. Sticky folders pin
below `topInset`, and drag edge-autoscroll is not implemented in this mode yet.

## React usage

```tsx
'use client';

import { FileTree, useFileTree } from '@pierre/trees/react';

export function Example({ paths }: { paths: string[] }) {
  const { model } = useFileTree({
    initialExpansion: 'open',
    paths,
    search: true,
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

`@pierre/trees/react` exports `FileTree`, `useFileTree`, `useFileTreeSearch`,
`useFileTreeSelection`, and `useFileTreeSelector`.

## SSR

```tsx
import { preloadFileTree } from '@pierre/trees/ssr';
import { FileTree, useFileTree } from '@pierre/trees/react';

const preloadedData = preloadFileTree({
  id: 'docs-tree',
  initialExpansion: 'open',
  paths: ['README.md', 'src/index.ts'],
  initialVisibleRowCount: 8,
});

export function HydratedTree() {
  const { model } = useFileTree({
    id: 'docs-tree',
    initialExpansion: 'open',
    paths: ['README.md', 'src/index.ts'],
    initialVisibleRowCount: 8,
  });

  return (
    <FileTree
      model={model}
      preloadedData={preloadedData}
      style={{ height: '240px' }}
    />
  );
}
```

`preloadFileTree()` returns `FileTreeSsrPayload`:

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
when inserting the full container string through DOM APIs like `innerHTML` or
`dangerouslySetInnerHTML`. Pass `{ id, shadowHtml }` to the React component as
`preloadedData`.

## Styling

The host element and shadow root read CSS variables such as:

- `--trees-selected-bg-override`
- `--trees-border-color-override`
- `--trees-fg-override`
- `--trees-theme-*`

Translate a Shiki or VS Code theme into tree CSS with `themeToTreeStyles()`:

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

Import the web-components entry point only when you need the custom element
registration side effect:

```ts
import '@pierre/trees/web-components';
```

## Icons, git status, and composition

The root package exports icon, git-status, context-menu, drag/drop, mutation,
and row-decoration types. Public callbacks report canonical paths.

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
to `'right-click'`. Set `triggerMode` to `'button'` or `'both'` for the
dedicated right-side action lane. In button-capable modes, `buttonVisibility`
defaults to `'when-needed'`; set it to `'always'` to show decorative per-row
affordances while the tree still uses one floating trigger button and one
slotted menu surface.

`renderRowDecoration` owns a flexible row lane. Built-in git status uses the
next fixed lane, so custom decoration content, git status, and the context-menu
affordance can appear on the same row.

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
