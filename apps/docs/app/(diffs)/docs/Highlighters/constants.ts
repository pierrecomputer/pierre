import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const HIGHLIGHTERS_REACT_EXAMPLE = docsCodeSnippet(
  'highlighter.tsx',
  `import { File } from '@pierre/diffs/react';

export function Example() {
  return (
    <File
      file={{ name: 'example.ts', contents: 'const greeting = "Hello";' }}
      options={{
        preferredHighlighter: 'highlights',
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
      }}
    />
  );
}`
);
