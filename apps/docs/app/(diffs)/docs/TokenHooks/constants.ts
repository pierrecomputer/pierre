import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const TOKEN_HOOKS_REACT: PreloadFileOptions<undefined> = {
  file: {
    name: 'token_interactions.tsx',
    contents: `import type { DiffTokenEventBaseProps } from '@pierre/diffs';
import { MultiFileDiff } from '@pierre/diffs/react';

const oldFile = {
  name: 'hover.ts',
  contents: 'function greet(name: string) {\n  return name;\n}',
};

const newFile = {
  name: 'hover.ts',
  contents: 'function greet(userName: string) {\n  return userName;\n}',
};

export function TokenHoverExample() {
  return (
    <MultiFileDiff
      oldFile={oldFile}
      newFile={newFile}
      options={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },

        // Experimental API. Subject to change.
        onTokenEnter({
          lineNumber,
          lineCharStart,
          lineCharEnd,
          side,
          tokenElement,
          tokenText,
        }: DiffTokenEventBaseProps) {
          // Designed to pair well with LSP APIs such as textDocument/hover.
          console.log('hover token', {
            lineNumber,
            lineCharStart,
            lineCharEnd,
            side,
            tokenText,
          });

          // If you would like to apply hover styles to the token,
          // you could do so with the element reference
          tokenElement.style.backgroundColor = 'light-dark(black, white)';
          tokenElement.style.color = 'light-dark(white, black)';
          tokenElement.style.borderRadius = '2px';
        },

        onTokenLeave({ tokenElement }: DiffTokenEventBaseProps) {
          // Just don't forget to zero out the styles on leave
          tokenElement.style.backgroundColor = '';
          tokenElement.style.color = '';
          tokenElement.style.borderRadius = '';
        },

        onTokenClick({
          tokenText,
          lineNumber,
          lineCharStart,
          lineCharEnd,
          side,
        }: DiffTokenEventBaseProps) {
          console.log('clicked token', {
            tokenText,
            lineNumber,
            lineCharStart,
            lineCharEnd,
            side,
          });
        },
      }}
    />
  );
}`,
  },
  options,
};

export const TOKEN_HOOKS_VANILLA: PreloadFileOptions<undefined> = {
  file: {
    name: 'token_interactions.ts',
    contents: `import { FileDiff, type DiffTokenEventBaseProps } from '@pierre/diffs';

const instance = new FileDiff({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },

  // Experimental API. Subject to change.
  onTokenEnter({
    lineNumber,
    lineCharStart,
    lineCharEnd,
    side,
    tokenElement,
    tokenText,
  }: DiffTokenEventBaseProps) {
    // Designed to pair well with LSP APIs such as textDocument/hover.
    console.log('hover token', {
      lineNumber,
      lineCharStart,
      lineCharEnd,
      side,
      tokenText,
    });

    tokenElement.style.backgroundColor = 'light-dark(black, white)';
    tokenElement.style.color = 'light-dark(white, black)';
    tokenElement.style.borderRadius = '2px';
  },

  onTokenLeave({ tokenElement }: DiffTokenEventBaseProps) {
    tokenElement.style.backgroundColor = '';
    tokenElement.style.color = '';
    tokenElement.style.borderRadius = '';
  },

  onTokenClick({
    tokenText,
    lineNumber,
    lineCharStart,
    lineCharEnd,
    side,
  }: DiffTokenEventBaseProps) {
    console.log('clicked token', {
      tokenText,
      lineNumber,
      lineCharStart,
      lineCharEnd,
      side,
    });
  },

  onLineClick({ lineNumber, side }) {
    console.log('clicked line', { lineNumber, side });
  },
});

instance.render({
  oldFile: {
    name: 'hover.ts',
    contents: 'function greet(name: string) {\n  return name;\n}',
  },
  newFile: {
    name: 'hover.ts',
    contents: 'function greet(userName: string) {\n  return userName;\n}',
  },
  containerWrapper: document.getElementById('diff-container'),
});`,
  },
  options,
};
