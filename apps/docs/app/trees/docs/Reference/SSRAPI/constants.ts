import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const SSR_API_EXAMPLE = docsCodeSnippet(
  'preload-file-tree.ts',
  `import { preloadFileTree } from '@pierre/trees/ssr';

const payload = preloadFileTree({
  preparedInput,
  id: 'project-tree',
  initialExpandedPaths: ['src'],
  initialVisibleRowCount: 11,
});`
);
