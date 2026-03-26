# @pierre/trees

File tree UI built on `@headless-tree/core`, shipped as:

- A Shadow DOM custom element (`<file-tree-container>`)
- An imperative JS API (`new FileTree(...)`)
- A React wrapper (client component) for controlled/uncontrolled state

The component is styled via CSS custom properties and encapsulates styles inside
its shadow root (SSR and CSR).

## Install

```bash
bun add @pierre/trees
```

## Vanilla Usage

```ts
import { FileTree } from '@pierre/trees';

const ft = new FileTree({
  initialFiles: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
  flattenEmptyDirectories: true,
  useLazyDataLoader: true,
});

ft.render({ containerWrapper: document.getElementById('mount')! });
```

To clean up:

```ts
ft.cleanUp();
```

## React Usage (Client)

```tsx
'use client';

import { FileTree } from '@pierre/trees/react';

export function Example({ files }: { files: string[] }) {
  return (
    <FileTree
      options={{ flattenEmptyDirectories: true }}
      files={files}
      initialExpandedItems={['src']}
      onExpandedItemsChange={(paths) => {
        console.log('expanded', paths);
      }}
    />
  );
}
```

## Header And Context Menu Slots

The tree can expose extension points in light DOM:

- `slot="header"` for custom header UI
- `slot="context-menu"` for custom context menu UI

You can import slot names from `@pierre/trees`:

```ts
import { CONTEXT_MENU_SLOT_NAME, HEADER_SLOT_NAME } from '@pierre/trees';
```

### Vanilla context menu

Provide `onContextMenuOpen` and render your own menu into `slot="context-menu"`
(for example shadcn, react-aria, or any custom menu).

```ts
import { CONTEXT_MENU_SLOT_NAME, FileTree } from '@pierre/trees';

const host = document.getElementById('tree') as HTMLElement;
const slot = document.createElement('div');
slot.setAttribute('slot', CONTEXT_MENU_SLOT_NAME);
host.appendChild(slot);

const fileTree = new FileTree(
  { initialFiles: ['README.md', 'src/index.ts'] },
  {
    onContextMenuOpen: (item, context) => {
      slot.textContent = `${item.path}`;
      // context.anchorElement / context.anchorRect are provided for positioning.
      // context.close() should be called when your menu closes.
    },
    onContextMenuClose: () => {
      slot.textContent = '';
    },
  }
);
```

### React context menu

Use `renderContextMenu` on the React wrapper to render into the context-menu
slot. The callback receives the same `item` and `context`.

```tsx
import { FileTree } from '@pierre/trees/react';

<FileTree
  options={{}}
  initialFiles={['README.md', 'src/index.ts']}
  renderContextMenu={(item, context) => (
    <MyMenu
      item={item}
      anchor={context.anchorElement}
      onClose={context.close}
    />
  )}
/>;
```

## Files API Contract

- Paths use forward slashes. End a path with `/` to create an explicit directory
  entry, including an empty folder.
- `initialFiles` is the uncontrolled initial value and is only used when a tree
  instance is created.
- React controlled usage should pass `files` and keep parent state
  authoritative.
- `onFilesChange` fires when files are applied via:
  - `fileTree.setFiles(nextFiles)`
  - `fileTree.setOptions(..., { files: nextFiles })` (including when structural
    options are changed in the same call)
- `onFilesChange` does not fire for a no-op update where the exact same array
  reference is provided.
- In controlled React mode, use identity-preserving updates in the callback to
  avoid loops:

```tsx
onFilesChange={(nextFiles) => setFiles((prev) => (prev === nextFiles ? prev : nextFiles))}
```

## SSR With Declarative Shadow DOM (No Flash)

To avoid a flash of unstyled content (FOUC), SSR should inline the component's
styles in the shadow root. Declarative Shadow DOM is the intended path.

### 1) Server: generate shadow-root HTML

```tsx
import { preloadFileTree } from '@pierre/trees/ssr';

export function FileTreeSsr({ files }: { files: string[] }) {
  const payload = preloadFileTree({
    initialFiles: files,
    flattenEmptyDirectories: true,
    useLazyDataLoader: true,
  });

  return (
    <div
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: payload.html }}
    />
  );
}
```

### 2) Client: hydrate the existing element

With React:

```tsx
'use client';

import { FileTree } from '@pierre/trees/react';

export function FileTreeHydrate({
  id,
  files,
}: {
  id: string;
  files: string[];
}) {
  return <FileTree containerId={id} options={{}} files={files} />;
}
```

Or with the imperative API:

```ts
import { FileTree } from '@pierre/trees';

const ft = new FileTree({ initialFiles: files });
ft.hydrate({ fileTreeContainer: document.getElementById(id)! });
```

## Styling

The custom element exposes CSS variables (e.g. `--trees-font-family-override`,
`--trees-border-color-override`) that are read inside the shadow root.

## Development

From `packages/trees`:

```bash
bun test
bun run benchmark
bun run benchmark:core
bun run test:e2e
bun run tsc
bun run build
```

Testing policy and E2E guidance:

- `test/TESTING.md`

## Benchmarking

The `trees` package includes a dedicated `fileListToTree` benchmark runner:

```bash
bun ws trees benchmark
```

Use `--case` to focus on a subset while iterating locally:

```bash
bun ws trees benchmark -- --case=deep
bun ws trees benchmark -- --case=linux --runs=10 --warmup-runs=2
```

The default suite mixes synthetic shapes with two real fixtures so changes are
measured against both controlled and realistic inputs:

- `tiny-flat`, `small-mixed`, `medium-balanced`, `large-wide`,
  `large-deep-chain`, `large-monorepo-shaped`, and `explicit-directories`
- `fixture-linux-kernel-files`, loaded from
  `apps/docs/app/trees-dev/linux-files.json`
- `fixture-pierrejs-repo-snapshot`, a fixed snapshot of this repo at
  `packages/trees/scripts/fixtures/fileListToTree-monorepo-snapshot.txt`

The benchmark records:

- end-to-end `fileListToTree` timing
- stage timings for `buildPathGraph`, `buildFlattenedNodes`, `buildFolderNodes`,
  and `hashTreeKeys`
- a deterministic checksum per case so behavior changes are visible alongside
  timing changes

Use `--json` when you want machine-readable output or a saved baseline:

```bash
bun ws trees benchmark -- --json > tmp/fileListToTree-baseline.json
```

Use `--compare` to run the current code against a saved JSON baseline:

```bash
bun ws trees benchmark -- --compare tmp/fileListToTree-baseline.json
bun ws trees benchmark -- --case=linux --compare tmp/fileListToTree-baseline.json --json
```

`--compare` matches cases by name, reports median deltas, and flags checksum
mismatches. That makes it useful both for performance regressions and for
catching accidental behavior changes while refactoring.

For core tree primitive profiling, use the dedicated benchmark runner:

```bash
bun ws trees benchmark:core
```

If you care most about large datasets, run a filtered large-shape subset:

```bash
bun ws trees benchmark:core -- --case=large-wide --case=large-monorepo --case=linux
```

This benchmark isolates core tree costs by preparing fixture-backed tree data up
front and timing only primitive calls. The `createTree` timing reflects the real
initialization path (`createTree` + `setMounted(true)` + initial `rebuildTree`).
`rebuildTree` can run either as unchanged hot rebuilds or as changed-state
rebuilds via `--rebuild-mode=expanded-copy`.

To better mirror the trees-dev virtualization workload, benchmark cases are
built with `sort: false` and `flattenEmptyDirectories: true`.

It also supports `--json`, `--compare`, and `--case` filters, plus:

- `--create-iterations` to batch multiple create+mount+initial-rebuild calls per
  measured sample
- `--rebuild-iterations` to batch multiple `rebuildTree` calls per measured
  sample
- `--rebuild-mode` to choose unchanged rebuilds or a changed-state mode
  (`expanded-copy`) with stronger update-path signal
- `--feature-profile` to switch between `virtualized-card` realism,
  `root-default`, and `minimal` core-only feature overhead

Those batching flags improve confidence for fast operations by reducing timer
jitter while still reporting per-call milliseconds.

# Credits and Acknolwedgements

The core of this library's underlying tree implementation started as a hard fork
of [@headless-tree/core](https://github.com/lukasbach/headless-tree) by
[@lukasbach](https://github.com/lukasbach) under the MIT License (forked at
1.6.1). This library is invaluable, and if you're interested in a headless tree
implementation it is one of the best possible places to start. We opted to fork
it only to meet some extreme customizations we wanted to make quickly for our
specific use-cases. Ultimately, we hope to offer anything generalizable back
upstream if it's desired. We have ported many of the tests from the library as
well in an attempt to maintain as much compatibility for future collaboration.
