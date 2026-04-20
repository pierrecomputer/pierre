import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const SSR_PRELOAD_FILE_TREE: PreloadFileOptions<undefined> = {
  file: {
    name: 'preloadFileTree.ts',
    contents: `import { preloadFileTree } from '@pierre/trees/ssr';
import type { FileTreeOptions, FileTreeStateConfig } from '@pierre/trees';

// Prerender the file tree HTML on the server for fast first paint.
// Hydrate on the client with the same options.

// Server (e.g. Next.js app router page)
const fileTreeOptions: FileTreeOptions = {
  initialFiles: ['README.md', 'src/index.ts', 'src/utils/helper.ts'],
  flattenEmptyDirectories: true,
};

// Optional: pass initial state so the SSR output matches client hydration
const stateConfig: FileTreeStateConfig = {
  initialExpandedItems: ['src'],
};

export default async function Page() {
  const payload = preloadFileTree(fileTreeOptions, stateConfig);

  return (
    <div
      dangerouslySetInnerHTML={{
        __html: payload.domOuterStart + payload.shadowHtml + payload.outerEnd,
      }}
      data-file-tree-props={JSON.stringify(fileTreeOptions)}
    />
  );
}

// Client: pass { id, shadowHtml } as preloadedData in React, or use vanilla
// FileTree with the same options + container that holds the prerendered
// markup.
`,
  },
  options,
};

export const SSR_HYDRATION_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'hydrate_file_tree.ts',
    contents: `import { FileTree } from '@pierre/trees';

const files = ['src/index.ts', 'src/components/Button.tsx', 'package.json'];

const fileTree = new FileTree({ initialFiles: files });

const container = document.querySelector('file-tree-container');
if (container instanceof HTMLElement) {
  fileTree.hydrate({ fileTreeContainer: container });
}`,
  },
  options,
};
