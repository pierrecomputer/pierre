import type { PreloadFileOptions } from '@pierre/diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
} as const;

export const STYLING_CODE_GLOBAL: PreloadFileOptions<undefined> = {
  file: {
    name: 'global.css',
    contents: `/* Target the file tree host (custom element or React root) */
file-tree-container,
.my-file-tree {
  --trees-font-size-override: 14px;
  --trees-row-height-override: 32px;
  --trees-fg-override: oklch(0.25 0 0);
  --trees-bg-override: oklch(0.98 0 0);
  --trees-border-color-override: oklch(0.9 0 0);
  --trees-border-radius-override: 8px;
  --trees-selected-bg-override: oklch(0.92 0.02 250);
  --trees-selected-border-color-override: oklch(0.7 0.15 250);
  /* Optional. Used for gitStatus. */
  --trees-git-added-color-override: #0dbe4e;
  --trees-git-modified-color-override: #009fff;
  --trees-git-deleted-color-override: #ff2e3f;
}`,
  },
  options,
};

export const STYLING_CODE_INLINE: PreloadFileOptions<undefined> = {
  file: {
    name: 'FileExplorer.tsx',
    contents: `import { FileTree } from '@pierre/trees/react';

<FileTree
  options={{ initialFiles: ['src/index.ts', 'package.json'] }}
  className="rounded-lg border p-3"
  style={{
    maxHeight: 400,
    '--trees-font-size-override': '13px',
    '--trees-row-height-override': '28px',
  } as React.CSSProperties}
/>`,
  },
  options,
};
