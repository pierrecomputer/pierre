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
  --ft-font-size: 14px;
  --ft-row-height: 32px;
  --ft-color-foreground: oklch(0.25 0 0);
  --ft-color-background: oklch(0.98 0 0);
  --ft-color-border: oklch(0.9 0 0);
  --ft-border-radius: 8px;
  --ft-selected-background-color: oklch(0.92 0.02 250);
  --ft-selected-border-color: oklch(0.7 0.15 250);
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
    '--ft-font-size': '13px',
    '--ft-row-height': '28px',
  } as React.CSSProperties}
/>`,
  },
  options,
};
