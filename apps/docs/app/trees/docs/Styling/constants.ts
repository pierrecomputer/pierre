import type { PreloadFileOptions } from '@pierre/diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
} as const;

export const STYLING_CODE_GLOBAL: PreloadFileOptions<undefined> = {
  file: {
    name: 'global.css',
    contents: `/* Target the FileTree host (custom element or React root). */
file-tree-container,
.project-sidebar {
  width: 320px;
  max-height: 420px;
  border-radius: 12px;
  overflow: hidden;

  --trees-font-family-override: 'Berkeley Mono', monospace;
  --trees-font-size-override: 13px;
  --trees-row-height-override: 28px;
  --trees-item-padding-x-override: 10px;
  --trees-border-radius-override: 10px;

  --trees-fg-override: oklch(25% 0 0);
  --trees-bg-override: oklch(98% 0 0);
  --trees-bg-muted-override: oklch(95% 0 0);
  --trees-border-color-override: oklch(90% 0 0);

  --trees-selected-fg-override: oklch(29% 0.09 255);
  --trees-selected-bg-override: oklch(92% 0.05 255);
  --trees-selected-focused-border-color-override: oklch(67% 0.16 255);

  --trees-search-bg-override: white;
  --trees-search-fg-override: oklch(28% 0 0);

  /* Optional: tune git decoration colors independently. */
  --trees-git-added-color-override: #0dbe4e;
  --trees-git-modified-color-override: #009fff;
  --trees-git-deleted-color-override: #ff2e3f;
}`,
  },
  options,
};

export const STYLING_CODE_INLINE: PreloadFileOptions<undefined> = {
  file: {
    name: 'DenseTree.tsx',
    contents: `import { FileTree } from '@pierre/trees/react';
import type { CSSProperties } from 'react';

<FileTree
  options={{ initialFiles: ['src/index.ts', 'package.json'] }}
  className="rounded-xl border p-2"
  style={{
    maxHeight: 360,
    width: 320,
    '--trees-font-family-override': 'Berkeley Mono, monospace',
    '--trees-font-size-override': '13px',
    '--trees-row-height-override': '28px',
    '--trees-level-gap-override': '6px',
    '--trees-item-row-gap-override': '4px',
    '--trees-icon-width-override': '14px',
  } as CSSProperties}
/>`,
  },
  options,
};

export const STYLING_CODE_VANILLA: PreloadFileOptions<undefined> = {
  file: {
    name: 'file-tree.ts',
    contents: `import { FileTree } from '@pierre/trees';

const fileTree = new FileTree({
  initialFiles: ['src/index.ts', 'src/lib/utils.ts', 'package.json'],
});

fileTree.render({
  containerWrapper: document.getElementById('tree-root') ?? undefined,
});

const host = fileTree.getFileTreeContainer();

Object.assign(host.style, {
  width: '320px',
  maxHeight: '420px',
});

host.style.setProperty('--trees-row-height-override', '30px');
host.style.setProperty('--trees-font-size-override', '13px');
host.style.setProperty('--trees-selected-bg-override', 'oklch(90% 0.05 255)');
host.style.setProperty('--trees-git-modified-color-override', '#009fff');`,
  },
  options,
};

export const STYLING_CODE_UNSAFE: PreloadFileOptions<undefined> = {
  file: {
    name: 'unsafe-tree-css.tsx',
    contents: `import { FileTree } from '@pierre/trees/react';

<FileTree
  options={{
    initialFiles: ['src/index.ts', 'src/lib/utils.ts', 'package.json'],
    unsafeCSS: \`
      [data-file-tree-search-input] {
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      button[data-type='item'][data-item-selected] {
        border-radius: 999px;
      }

      [data-item-section='icon'] {
        color: oklch(67% 0.2 25);
      }
    \`,
  }}
/>;
`,
  },
  options,
};
