# @pierre/file-tree

File tree UI built on `@headless-tree/core`, shipped as:

- A Shadow DOM custom element (`<file-tree-container>`)
- An imperative JS API (`new FileTree(...)`)
- A React wrapper (client component) for controlled/uncontrolled state

The component is styled via CSS custom properties and encapsulates styles inside
its shadow root (SSR and CSR).

## Install

```bash
bun add @pierre/file-tree
```

## Vanilla Usage

```ts
import { FileTree } from '@pierre/file-tree';

const ft = new FileTree({
  files: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
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

import { FileTree } from '@pierre/file-tree/react';

export function Example({ files }: { files: string[] }) {
  return (
    <FileTree
      options={{ files, flattenEmptyDirectories: true }}
      defaultExpandedItems={['src']}
      onExpandedItemsChange={(paths) => {
        console.log('expanded', paths);
      }}
    />
  );
}
```

## SSR With Declarative Shadow DOM (No Flash)

To avoid a flash of unstyled content (FOUC), SSR should inline the component's
styles in the shadow root. Declarative Shadow DOM is the intended path.

### 1) Server: generate shadow-root HTML

```tsx
import { createFileTreeSsrPayload } from '@pierre/file-tree/ssr';

export function FileTreeSsr({ files }: { files: string[] }) {
  const payload = createFileTreeSsrPayload({
    files,
    flattenEmptyDirectories: true,
    useLazyDataLoader: true,
  });

  return (
    <file-tree-container id={payload.id} suppressHydrationWarning>
      <template
        // @ts-expect-error declarative shadow DOM
        shadowrootmode="open"
        dangerouslySetInnerHTML={{ __html: payload.shadowHtml }}
      />
    </file-tree-container>
  );
}
```

### 2) Client: hydrate the existing element

With React:

```tsx
'use client';

import { FileTree } from '@pierre/file-tree/react';

export function FileTreeHydrate({
  id,
  files,
}: {
  id: string;
  files: string[];
}) {
  return <FileTree containerId={id} options={{ files }} />;
}
```

Or with the imperative API:

```ts
import { FileTree } from '@pierre/file-tree';

const ft = new FileTree({ files });
ft.hydrate({ fileTreeContainer: document.getElementById(id)! });
```

## Styling

The custom element exposes CSS variables (e.g. `--ft-font-family`,
`--ft-color-border`) that are read inside the shadow root.

## Development

From `packages/file-tree`:

```bash
bun test
bun run tsc
bun run build
```
