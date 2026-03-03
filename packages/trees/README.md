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

## Files API Contract

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
bun run test:e2e
bun run tsc
bun run build
```

Testing policy and E2E guidance:

- `test/TESTING.md`
