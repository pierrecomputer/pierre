import { afterAll, describe, expect, test } from 'bun:test';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  parseDiffFromFile,
} from '../src';
import { columnCells, type RowSpec } from '../src/layout/RowSpec';
import type { SemanticDiffOperation } from '../src/types';
import { assertDefined, collectAllElements } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

// The line types on a column's "No newline at end of file" content row and
// its gutter cell.
function noNewlineLineTypes(rows: readonly RowSpec[] | undefined): unknown[] {
  assertDefined(rows, 'column rows should be defined');
  const { content, gutter } = columnCells(rows);
  return [
    ...collectAllElements(content).filter(
      (node) => 'data-no-newline' in node.properties
    ),
    ...collectAllElements(gutter).filter(
      (node) => node.properties['data-gutter-buffer'] === 'metadata'
    ),
  ].map((node) => node.properties['data-line-type']);
}

// Both files end without a newline, so each column draws a no-newline row under
// its last line: old 2 and new 3.
function renderNoNewlineRows(semanticOperations?: SemanticDiffOperation[]) {
  const fileDiff = parseDiffFromFile(
    { name: 'eof.txt', contents: 'same\nold-final' },
    { name: 'eof.txt', contents: 'same\nnew-a\nnew-final' }
  );
  fileDiff.semanticOperations = semanticOperations;
  return new DiffHunksRenderer({ diffStyle: 'split' }).asyncRender(fileDiff);
}

describe('no-newline row line type', () => {
  test('keeps the hunk change type without semantic data', async () => {
    const result = await renderNoNewlineRows();
    expect(noNewlineLineTypes(result.columns.deletions)).toEqual([
      'change-deletion',
      'change-deletion',
    ]);
    expect(noNewlineLineTypes(result.columns.additions)).toEqual([
      'change-addition',
      'change-addition',
    ]);
  });

  test("takes the semantic type of the region its side's last line ends", async () => {
    const result = await renderNoNewlineRows([
      {
        type: 'moved',
        spans: [
          { role: 'body', relation: 'moved', old: [], new: [], linePairs: [] },
        ],
        lines: {
          old: [{ start: 2, end: 2, spanIndex: 0 }],
          new: [{ start: 3, end: 3, spanIndex: 0 }],
        },
      },
    ]);
    expect(noNewlineLineTypes(result.columns.deletions)).toEqual([
      'change-moved',
      'change-moved',
    ]);
    expect(noNewlineLineTypes(result.columns.additions)).toEqual([
      'change-moved',
      'change-moved',
    ]);
  });
});
