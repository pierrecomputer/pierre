import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CUSTOM_HUNK_SEPARATORS_EXAMPLE } from '../../diff-examples/CustomHunkSeparators/constants';
import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export { CUSTOM_HUNK_SEPARATORS_EXAMPLE };

const fileOptions = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const CUSTOM_HUNK_SEPARATORS_SWITCHER: PreloadFileOptions<undefined> = {
  file: {
    name: 'custom_hunk_separators.tsx',
    contents: `import type { FileContents } from '@pierre/diffs';
import { MultiFileDiff } from '@pierre/diffs/react';

const customSeparatorCSS = \
\`
/* Fix bg colors to mux with background */
[data-separator="line-info-basic"] {
  height: 24px;
  background: var(--diffs-bg);
  position: relative;
}

/* Styles are made to target always the leftside gutter, however technically
 * these elements are rendered into every gutter and every content row giving you
 * lots of flexibility in how you may want to show or style them */
[data-diff-type="single"] [data-gutter],
[data-diff-type="split"] [data-deletions] [data-gutter] {
  [data-separator-wrapper] {
    position: absolute;
    left: 100%;
    display: flex;
    align-items: center;
    gap: unset;
    width: max-content;
    background: transparent;
    color: var(--diffs-fg-number);
    font-family: var(--diffs-header-font-family, var(--diffs-header-font-fallback));
    font-size: 0.75rem;
    /* Ensure Arrows align with number column */
    margin-left: calc(-2ch - 2px);
  }

  [data-separator-wrapper][data-separator-multi-button] {
    margin-left: calc(-3ch - 2px);
  }

  [data-expand-button],
  [data-separator-content] {
    display: block;
    align-self: unset;
    min-width: unset;
    min-height: unset;
    padding: 0;
    flex-shrink: 0;
    grid-column: unset;
    border: none;
    width: auto;
    height: auto;
    background-color: unset;
    color: inherit;
    font: inherit;
  }

  [data-expand-button]:not([data-expand-all-button]) {
    &[data-expand-down]::before {
      content: '↑';
    }

    &[data-expand-up]::before {
      content: '↓';
    }

    &[data-expand-both]::before {
      content: '↕';
    }

    /* Hide built in icon */
    svg {
      display: none;
    }
  }

  [data-separator-content] {
    background: transparent;
    margin-left: calc(2px + 1ch);
  }

  /* Expand all button will only appear if the collapsed region is larger than
   * an expand chunk */
  [data-expand-all-button] {
    position: relative;
    margin-left: 14px;
    text-transform: lowercase;

    &:hover {
      color: var(--diffs-fg);
      text-decoration: underline;
    }
  }

  /* A little dot separator */
  [data-expand-all-button]::before {
    content: '';
    display: block;
    position: absolute;
    top: 50%;
    left: -8px;
    margin-top: -1px;
    width: 3px;
    height: 3px;
    border-radius: 2px;
    background-color: var(--diffs-fg-number);
    pointer-events: none;
  }

  [data-separator-content]:hover,
  [data-expand-button]:hover,
  [data-expand-all-button]:hover {
    color: var(--diffs-fg);
  }
}
\`;

interface CustomSeparatorExampleProps {
  oldFile: FileContents;
  newFile: FileContents;
}

export function CustomSeparatorExample({
  oldFile,
  newFile,
}: CustomSeparatorExampleProps) {
  return (
    <MultiFileDiff
      oldFile={oldFile}
      newFile={newFile}
      options={{
        hunkSeparators: 'line-info-basic',
        expansionLineCount: 5,
        unsafeCSS: customSeparatorCSS,
      }}
    />
  );
}`,
  },
  options: fileOptions,
};
