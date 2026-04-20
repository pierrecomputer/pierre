import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const GIT_STATUS_BASIC: PreloadFileOptions<undefined> = {
  file: {
    name: 'git-status.ts',
    contents: `const fileTree = new FileTree({
  paths,
  gitStatus: [
    { path: 'README.md', status: 'untracked' },
    { path: 'package.json', status: 'renamed' },
    { path: 'src/index.ts', status: 'modified' },
    { path: 'src/components/Button.tsx', status: 'added' },
  ],
});`,
  },
  options,
};

export const GIT_STATUS_SET: PreloadFileOptions<undefined> = {
  file: {
    name: 'set-git-status.ts',
    contents: `fileTree.setGitStatus(nextStatuses);
fileTree.setGitStatus(undefined);`,
  },
  options,
};

export const GIT_STATUS_ROW_DECORATION: PreloadFileOptions<undefined> = {
  file: {
    name: 'render-row-decoration.ts',
    contents: `const fileTree = new FileTree({
  paths,
  renderRowDecoration: ({ item }) => {
    if (item.path.endsWith('.generated.ts')) {
      return { text: 'GEN', title: 'Generated file' };
    }

    if (item.path.startsWith('remote/')) {
      return { icon: 'icon-remote', title: 'Remote source' };
    }

    return null;
  },
});`,
  },
  options,
};
