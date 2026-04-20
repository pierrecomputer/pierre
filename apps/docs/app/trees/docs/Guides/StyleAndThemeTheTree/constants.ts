import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const STYLE_THEME_HOST_STYLING: PreloadFileOptions<undefined> = {
  file: {
    name: 'host-styling.tsx',
    contents: `<FileTree
  model={model}
  className="h-96 rounded-xl border"
  style={{
    backgroundColor: 'var(--panel)',
    borderColor: 'var(--border)',
  }}
/>`,
  },
  options,
};

export const STYLE_THEME_CSS_VARIABLES: PreloadFileOptions<undefined> = {
  file: {
    name: 'css-variables.tsx',
    contents: `<FileTree
  model={model}
  style={
    {
      '--trees-theme-list-active-selection-bg':
        'color-mix(in oklab, var(--accent) 24%, transparent)',
      '--trees-theme-list-hover-bg':
        'color-mix(in oklab, var(--accent) 12%, transparent)',
      '--trees-theme-focus-ring': 'var(--accent)',
    } as React.CSSProperties
  }
/>`,
  },
  options,
};

export const STYLE_THEME_TO_TREE_STYLES: PreloadFileOptions<undefined> = {
  file: {
    name: 'theme-to-tree-styles.tsx',
    contents: `import { themeToTreeStyles } from '@pierre/trees';

const treeStyles = themeToTreeStyles(theme);

<FileTree
  model={model}
  style={
    {
      ...treeStyles,
      '--trees-theme-list-active-selection-bg':
        'color-mix(in oklab, var(--accent) 28%, transparent)',
    } as React.CSSProperties
  }
/>;`,
  },
  options,
};

export const STYLE_THEME_UNSAFE_CSS: PreloadFileOptions<undefined> = {
  file: {
    name: 'unsafe-css.ts',
    contents: `const fileTree = new FileTree({
  paths,
  unsafeCSS: \`
    [data-item-button][data-item-focused="true"] {
      text-decoration: underline;
    }
  \`,
});`,
  },
  options,
};
