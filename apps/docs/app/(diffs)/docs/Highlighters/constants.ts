import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const HIGHLIGHTER_EXAMPLE = docsCodeSnippet(
  'highlighter.tsx',
  `import { canUseWASM } from '@pierre/diffs';

// Fall back to shiki-js where WebAssembly is missing or blocked.
const preferredHighlighter = canUseWASM() ? 'highlights' : 'shiki-js';

<FileDiff
  oldFile={oldFile}
  newFile={newFile}
  options={{ preferredHighlighter }}
/>`
);
