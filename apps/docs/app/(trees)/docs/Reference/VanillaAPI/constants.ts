import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const VANILLA_API_EXAMPLE = docsCodeSnippet(
  'vanilla-api.ts',
  `import { FileTree } from '@pierre/trees';

const fileTree = new FileTree({
  paths: ['README.md', 'src/index.ts'],
  search: true,
});

fileTree.render({ fileTreeContainer: container });`
);
