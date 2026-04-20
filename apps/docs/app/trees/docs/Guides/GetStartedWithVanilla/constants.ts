import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const VANILLA_QUICKSTART_INSTALL = docsCodeSnippet(
  'install.sh',
  `bun add @pierre/trees
# npm: npm install @pierre/trees
# pnpm: pnpm add @pierre/trees`
);

export const VANILLA_QUICKSTART_MOUNT_PROJECT_TREE = docsCodeSnippet(
  'mount-project-tree.ts',
  `import { FileTree, type FileTreePreparedInput } from '@pierre/trees';

export function mountProjectTree(
  container: HTMLElement,
  preparedInput: FileTreePreparedInput
) {
  const fileTree = new FileTree({
    preparedInput,
    search: true,
    initialExpandedPaths: ['src', 'src/components'],
  });

  container.style.height = '320px';
  fileTree.render({ fileTreeContainer: container });
  return fileTree;
}`
);

export const VANILLA_QUICKSTART_IMPERATIVE_USAGE = docsCodeSnippet(
  'imperative-usage.ts',
  `const fileTree = new FileTree({
  paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
  search: true,
});

fileTree.render({ fileTreeContainer: container });
fileTree.focusPath('src/index.ts');
fileTree.openSearch('button');

const selectedPaths = fileTree.getSelectedPaths();
const matchingPaths = fileTree.getSearchMatchingPaths();
const focusedPath = fileTree.getFocusedPath();
const buttonItem = fileTree.getItem('src/components/Button.tsx');
buttonItem?.select();`
);
