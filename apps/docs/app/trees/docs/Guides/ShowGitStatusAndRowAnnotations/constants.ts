import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const GIT_STATUS_BASIC = docsCodeSnippet(
  'git-status.ts',
  `const fileTree = new FileTree({
  paths,
  gitStatus: [
    { path: 'README.md', status: 'untracked' },
    { path: 'package.json', status: 'renamed' },
    { path: 'src/index.ts', status: 'modified' },
    { path: 'src/components/Button.tsx', status: 'added' },
  ],
});`
);

export const GIT_STATUS_SET = docsCodeSnippet(
  'set-git-status.ts',
  `fileTree.setGitStatus(nextStatuses);
fileTree.setGitStatus(undefined);`
);

export const GIT_STATUS_ROW_DECORATION = docsCodeSnippet(
  'render-row-decoration.ts',
  `const fileTree = new FileTree({
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
});`
);
