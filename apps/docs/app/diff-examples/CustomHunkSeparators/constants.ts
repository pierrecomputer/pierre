import { DEFAULT_THEMES } from '@pierre/diffs';
import type { PreloadMultiFileDiffOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

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
