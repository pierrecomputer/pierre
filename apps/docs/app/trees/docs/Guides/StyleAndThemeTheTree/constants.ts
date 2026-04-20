import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const STYLE_THEME_HOST_STYLING = docsCodeSnippet(
  'host-styling.tsx',
  `<FileTree
  model={model}
  className="h-96 rounded-xl border"
  style={{
    backgroundColor: 'var(--panel)',
    borderColor: 'var(--border)',
  }}
/>`
);

export const STYLE_THEME_CSS_VARIABLES = docsCodeSnippet(
  'css-variables.tsx',
  `<FileTree
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
/>`
);

export const STYLE_THEME_TO_TREE_STYLES = docsCodeSnippet(
  'theme-to-tree-styles.tsx',
  `import { themeToTreeStyles } from '@pierre/trees';

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
/>;`
);

export const STYLE_THEME_UNSAFE_CSS = docsCodeSnippet(
  'unsafe-css.ts',
  `const fileTree = new FileTree({
  paths,
  unsafeCSS: \`
    [data-item-button][data-item-focused="true"] {
      text-decoration: underline;
    }
  \`,
});`
);
