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

export const SSR_EXTERNAL_SCROLL_EXAMPLE = docsCodeSnippet(
  'external-scroll-ssr.ts',
  `import { preloadFileTree } from '@pierre/trees/scroll';

const payload = preloadFileTree({
  preparedInput,
  externalScroll: {
    initialSnapshot: {
      viewportTop: 0,
      viewportHeight: 480,
      topInset: 48,
    },
  },
  initialVisibleRowCount: 16,
});`
);
