import { describe, expect, test } from 'bun:test';
import type { ElementContent } from 'hast';

import {
  DiffHunksRenderer,
  type InjectedRow,
  parseDiffFromFile,
  type RenderedLineContext,
  type SplitInjectedRowPlacement,
  type UnifiedInjectedRowPlacement,
} from '../src';
import { UnresolvedFileHunksRenderer } from '../src/renderers/UnresolvedFileHunksRenderer';
import { createGutterGap, createHastElement } from '../src/utils/hast_utils';
import { parseMergeConflictDiffFromFile } from '../src/utils/parseMergeConflictDiffFromFile';
import { assertDefined, isHastElement } from './testUtils';

const inlineGutter = () => createGutterGap(undefined, 'annotation', 1);

function createInjectedRow(name: string): InjectedRow {
  return {
    content: createHastElement({
      tagName: 'div',
      properties: { 'data-test-inline-row': name },
    }),
    gutter: inlineGutter(),
  };
}

function getTopLevelRowNames(rows: ElementContent[]): string[] {
  return rows.flatMap((row) => {
    if (!isHastElement(row)) {
      return [];
    }
    const name = row.properties?.['data-test-inline-row'];
    return typeof name === 'string' ? [name] : [];
  });
}

function getTopLevelRowIndex(rows: ElementContent[], key: string): number {
  return rows.findIndex((row) => {
    return (
      isHastElement(row) && row.properties?.['data-test-inline-row'] === key
    );
  });
}

function getTopLevelLineIndex(
  rows: ElementContent[],
  lineNumber: number
): number {
  return rows.findIndex((row) => {
    return isHastElement(row) && row.properties?.['data-line'] === lineNumber;
  });
}

function getTopLevelBufferIndex(rows: ElementContent[]): number {
  return rows.findIndex((row) => {
    return (
      isHastElement(row) && row.properties?.['data-content-buffer'] != null
    );
  });
}

function findFirstElementWithProperty(
  rows: ElementContent[],
  property: string
): ElementContent | undefined {
  for (const row of rows) {
    if (!isHastElement(row)) {
      continue;
    }
    if (row.properties?.[property] != null) {
      return row;
    }
    const child = findFirstElementWithProperty(row.children, property);
    if (child != null) {
      return child;
    }
  }
  return undefined;
}

class UnifiedInjectedRowTestRenderer extends DiffHunksRenderer {
  protected override getUnifiedInjectedRowsForLine = (
    ctx: RenderedLineContext
  ): UnifiedInjectedRowPlacement | undefined => {
    if (ctx.additionLine?.lineNumber !== 1) {
      return undefined;
    }
    return { before: [createInjectedRow('unified-before-line-1')] };
  };
}

class SplitInjectedRowTestRenderer extends DiffHunksRenderer {
  protected override getSplitInjectedRowsForLine = (
    ctx: RenderedLineContext
  ): SplitInjectedRowPlacement | undefined => {
    if (ctx.splitLineIndex !== 0) {
      return undefined;
    }
    return {
      before: [
        {
          deletion: createInjectedRow('split-deletion-only'),
          addition: undefined,
        },
        {
          deletion: createInjectedRow('split-deletion-paired'),
          addition: createInjectedRow('split-addition-paired'),
        },
      ],
    };
  };
}

describe('injected row hooks', () => {
  test('unified hook inserts before rows before the triggering line', async () => {
    const renderer = new UnifiedInjectedRowTestRenderer({
      diffStyle: 'unified',
    });
    const diff = parseDiffFromFile(
      { name: 'file.ts', contents: 'const a = 1;\nconst b = 2;\n' },
      { name: 'file.ts', contents: 'const a = 1;\nconst c = 3;\n' }
    );

    const result = await renderer.asyncRender(diff);

    assertDefined(result.unifiedContentAST, 'expected unified content AST');
    const lineIndex = getTopLevelLineIndex(result.unifiedContentAST, 1);
    const inlineRowIndex = getTopLevelRowIndex(
      result.unifiedContentAST,
      'unified-before-line-1'
    );

    expect(result.rowCount).toBe(diff.unifiedLineCount + 1);
    expect(lineIndex).toBeGreaterThanOrEqual(0);
    expect(inlineRowIndex + 1).toBe(lineIndex);
  });

  test('split hook preserves one-sided buffering before later paired rows', async () => {
    const renderer = new SplitInjectedRowTestRenderer({ diffStyle: 'split' });
    const diff = parseDiffFromFile(
      {
        name: 'file.ts',
        contents: 'const a = 1;\nconst b = 2;\nconst e = 2;\n',
      },
      { name: 'file.ts', contents: 'const a = 1;\nconst c = 3;\n' }
    );

    const result = await renderer.asyncRender(diff);

    assertDefined(result.deletionsContentAST, 'expected deletions content AST');
    assertDefined(result.additionsContentAST, 'expected additions content AST');

    expect(result.rowCount).toBe(diff.splitLineCount + 2);
    expect(getTopLevelRowNames(result.deletionsContentAST)).toEqual([
      'split-deletion-only',
      'split-deletion-paired',
    ]);
    expect(getTopLevelRowNames(result.additionsContentAST)).toEqual([
      'split-addition-paired',
    ]);

    const additionBufferIndex = getTopLevelBufferIndex(
      result.additionsContentAST
    );
    const additionPairedIndex = getTopLevelRowIndex(
      result.additionsContentAST,
      'split-addition-paired'
    );
    const deletionOnlyIndex = getTopLevelRowIndex(
      result.deletionsContentAST,
      'split-deletion-only'
    );
    const deletionPairedIndex = getTopLevelRowIndex(
      result.deletionsContentAST,
      'split-deletion-paired'
    );

    expect(additionBufferIndex).toBeGreaterThanOrEqual(0);
    expect(additionPairedIndex).toBeGreaterThan(additionBufferIndex);
    expect(deletionOnlyIndex).toBeGreaterThanOrEqual(0);
    expect(deletionPairedIndex).toBeGreaterThan(deletionOnlyIndex);
  });

  test('unresolved renderer emits merge conflict action rows inline', async () => {
    const file = {
      name: 'conflict.ts',
      contents: [
        'const before = true;',
        '<<<<<<< HEAD',
        'const ours = true;',
        '=======',
        'const theirs = true;',
        '>>>>>>> topic',
        'const after = true;',
      ].join('\n'),
    };
    const {
      fileDiff,
      actions,
      markerRows: conflictMarkerRows,
    } = parseMergeConflictDiffFromFile(file);
    const renderer = new UnresolvedFileHunksRenderer();
    renderer.setConflictState(actions, conflictMarkerRows, fileDiff);

    const result = await renderer.asyncRender(fileDiff);

    assertDefined(result.unifiedContentAST, 'expected unified content AST');
    const actionRowIndex = result.unifiedContentAST.findIndex((row) => {
      return (
        isHastElement(row) &&
        row.properties?.['data-merge-conflict-actions'] != null
      );
    });
    const actionButton = findFirstElementWithProperty(
      result.unifiedContentAST,
      'data-merge-conflict-action'
    );
    const actionAnchorIndex = getTopLevelLineIndex(result.unifiedContentAST, 1);
    const markerRows = result.unifiedContentAST.filter((row) => {
      return (
        isHastElement(row) &&
        row.properties?.['data-merge-conflict-marker-row'] != null
      );
    });

    expect(result.rowCount).toBe(
      fileDiff.unifiedLineCount + actions.length + markerRows.length
    );
    expect(markerRows).toHaveLength(3);
    expect(actionRowIndex).toBe(actionAnchorIndex + 1);
    assertDefined(actionButton, 'expected merge conflict action button');
    expect(isHastElement(actionButton)).toBe(true);
  });
});
