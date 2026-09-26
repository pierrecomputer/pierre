import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const HIGHLIGHTER_EXAMPLE = docsCodeSnippet(
  'highlighter.tsx',
  `<FileDiff
  oldFile={oldFile}
  newFile={newFile}
  options={{ preferredHighlighter: 'highlights' }}
/>`
);
