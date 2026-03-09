import type { PreloadFileOptions } from '@pierre/diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
} as const;

export const THEMING_CODE_RESOLVE_THEME: PreloadFileOptions<undefined> = {
  file: {
    name: 'TreeWithTheme.tsx',
    contents: `import { resolveTheme } from '@pierre/diffs';
import { themeToTreeStyles } from '@pierre/trees';
import { FileTree } from '@pierre/trees/react';
import { useEffect, useState } from 'react';

export function TreeWithTheme() {
  const [treeStyles, setTreeStyles] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    async function loadTheme() {
      const theme = await resolveTheme('github-dark');
      setTreeStyles(themeToTreeStyles(theme));
    }

    void loadTheme();
  }, []);

  return (
    <FileTree
      options={{ initialFiles: ['src/index.ts', 'package.json'] }}
      style={{
        ...(treeStyles ?? {}),
        '--trees-row-height-override': '28px',
      }}
    />
  );
}`,
  },
  options,
};

export const THEMING_CODE_CUSTOM_THEME: PreloadFileOptions<undefined> = {
  file: {
    name: 'custom-theme.ts',
    contents: `import { themeToTreeStyles } from '@pierre/trees';

const customTheme = {
  type: 'dark',
  bg: '#0b1020',
  fg: '#e5eefc',
  colors: {
    'sideBar.background': '#0b1020',
    'sideBar.foreground': '#e5eefc',
    'sideBar.border': 'rgba(148, 163, 184, 0.18)',
    'list.hoverBackground': 'rgba(96, 165, 250, 0.08)',
    'list.activeSelectionBackground': 'rgba(96, 165, 250, 0.16)',
    'list.activeSelectionForeground': '#ffffff',
    'gitDecoration.addedResourceForeground': '#4ade80',
    'gitDecoration.modifiedResourceForeground': '#60a5fa',
    'gitDecoration.deletedResourceForeground': '#f87171',
  },
} as const;

const treeStyles = themeToTreeStyles(customTheme);

<FileTree
  options={{ initialFiles: ['src/index.ts', 'package.json'] }}
  style={treeStyles}
/>`,
  },
  options,
};
