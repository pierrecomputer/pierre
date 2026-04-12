import { DEFAULT_THEMES } from '@pierre/diffs';
import type { PreloadMultiFileDiffOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

// Restyle the built-in line-info-basic separator to resemble the old custom
// example without supplying custom separator markup.
export const CUSTOM_HUNK_SEPARATORS_CUSTOM_CSS = `
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
    display: block;
    background-color: unset;
    color: inherit;
    font: inherit;
    color: inherit;
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
    margin-right: 0.5rem;
    pointer-events: none;
  }

  [data-separator-content]:hover,
  [data-expand-button]:hover,
  [data-expand-all-button]:hover {
    color: var(--diffs-fg);
  }
}
`;

function createTaskSummarySource(version: 'old' | 'new'): string {
  const lines: string[] = [
    'type Task = { id: string; payload: string };',
    '',
    'export function createTaskSummary(tasks: Task[]): string[] {',
    '  const summary: string[] = [];',
    '',
  ];

  for (let checkpoint = 1; checkpoint <= 72; checkpoint++) {
    if (checkpoint === 6) {
      lines.push(
        version === 'new'
          ? "  summary.push('phase:boot-ready');"
          : "  summary.push('phase:boot');"
      );
      continue;
    }

    if (checkpoint === 34) {
      lines.push(
        version === 'new'
          ? '  summary.push(`phase:mid-${tasks.length}`);'
          : "  summary.push('phase:mid');"
      );
      continue;
    }

    if (checkpoint === 58) {
      if (version === 'new') {
        lines.push('  if (tasks.length > 0) {');
        lines.push('    summary.push(`phase:tail-${tasks[0].id}`);');
        lines.push('  }');
      } else {
        lines.push("  summary.push('phase:tail');");
      }
      continue;
    }

    lines.push(
      `  summary.push('checkpoint-${String(checkpoint).padStart(2, '0')}');`
    );
  }

  lines.push('', '  return summary;', '}', '');
  return lines.join('\n');
}

export const CUSTOM_HUNK_SEPARATORS_EXAMPLE: PreloadMultiFileDiffOptions<undefined> =
  {
    oldFile: {
      name: 'task-summary.ts',
      contents: createTaskSummarySource('old'),
    },
    newFile: {
      name: 'task-summary.ts',
      contents: createTaskSummarySource('new'),
    },
    options: {
      theme: DEFAULT_THEMES,
      themeType: 'dark',
      diffStyle: 'split',
      expansionLineCount: 5,
      hunkSeparators: 'line-info',
      unsafeCSS: CustomScrollbarCSS,
    },
  };
