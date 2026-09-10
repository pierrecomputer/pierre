import { afterAll, describe, expect, test } from 'bun:test';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  type InjectedRow,
  parseDiffFromFile,
  type RenderedLineContext,
  type SplitInjectedRowPlacement,
  type UnifiedInjectedRowPlacement,
} from '../src';
import { UnresolvedFileHunksRenderer } from '../src/renderers/UnresolvedFileHunksRenderer';
import type { RenderedRow } from '../src/types';
import { parseMergeConflictDiffFromFile } from '../src/utils/parseMergeConflictDiffFromFile';
import { createGutterGap, createHTMLElement } from '../src/utils/toHtml';
import { rowProperties } from './testUtils';
import { assertDefined, collectAllElements } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

const inlineGutter = () => createGutterGap(undefined, 'annotation', 1);

function createInjectedRow(name: string): InjectedRow {
  return {
    content: createHTMLElement('div', { 'data-test-inline-row': name }),
    gutter: inlineGutter(),
  };
}

function getTopLevelRowNames(rows: RenderedRow[]): string[] {
  return rows.flatMap((row) => {
    const name = rowProperties(row)['data-test-inline-row'];
    return typeof name === 'string' ? [name] : [];
  });
}

function getTopLevelRowIndex(rows: RenderedRow[], key: string): number {
  return rows.findIndex((row) => {
    return rowProperties(row)['data-test-inline-row'] === key;
  });
}

function getTopLevelLineIndex(rows: RenderedRow[], lineNumber: number): number {
  return rows.findIndex((row) => {
    return rowProperties(row)['data-line'] === lineNumber;
  });
}

function getTopLevelBufferIndex(rows: RenderedRow[]): number {
  return rows.findIndex((row) => {
    return rowProperties(row)['data-content-buffer'] != null;
  });
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

    assertDefined(result.unifiedContentRows, 'expected unified content AST');
    const lineIndex = getTopLevelLineIndex(result.unifiedContentRows, 1);
    const inlineRowIndex = getTopLevelRowIndex(
      result.unifiedContentRows,
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

    assertDefined(
      result.deletionsContentRows,
      'expected deletions content AST'
    );
    assertDefined(
      result.additionsContentRows,
      'expected additions content AST'
    );

    expect(result.rowCount).toBe(diff.splitLineCount + 2);
    expect(getTopLevelRowNames(result.deletionsContentRows)).toEqual([
      'split-deletion-only',
      'split-deletion-paired',
    ]);
    expect(getTopLevelRowNames(result.additionsContentRows)).toEqual([
      'split-addition-paired',
    ]);

    const additionBufferIndex = getTopLevelBufferIndex(
      result.additionsContentRows
    );
    const additionPairedIndex = getTopLevelRowIndex(
      result.additionsContentRows,
      'split-addition-paired'
    );
    const deletionOnlyIndex = getTopLevelRowIndex(
      result.deletionsContentRows,
      'split-deletion-only'
    );
    const deletionPairedIndex = getTopLevelRowIndex(
      result.deletionsContentRows,
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

    assertDefined(result.unifiedContentRows, 'expected unified content AST');
    const actionRowIndex = result.unifiedContentRows.findIndex((row) => {
      return rowProperties(row)['data-merge-conflict-actions'] != null;
    });
    const actionButtons = collectAllElements(result.unifiedContentRows).filter(
      (el) => el.properties?.['data-merge-conflict-action'] != null
    );
    const actionAnchorIndex = getTopLevelLineIndex(
      result.unifiedContentRows,
      1
    );
    const markerRows = result.unifiedContentRows.filter((row) => {
      return rowProperties(row)['data-merge-conflict-marker-row'] != null;
    });

    // The fixture declares one conflict region with three marker lines
    // (<<<<<<<, =======, >>>>>>>), so the parser reports one action row and
    // three marker rows; the renderer must emit exactly those rows on top of
    // the diff's own unified lines.
    expect(actions).toHaveLength(1);
    expect(conflictMarkerRows).toHaveLength(3);
    expect(markerRows).toHaveLength(conflictMarkerRows.length);
    expect(result.rowCount).toBe(
      fileDiff.unifiedLineCount + actions.length + conflictMarkerRows.length
    );
    expect(actionRowIndex).toBe(actionAnchorIndex + 1);
    // The action row carries the three default resolution buttons, each tagged
    // with the conflict (index 0, the fixture's only one) it resolves.
    expect(
      actionButtons.map((button) => ({
        tagName: button.tagName,
        action: button.properties?.['data-merge-conflict-action'],
        conflictIndex:
          button.properties?.['data-merge-conflict-conflict-index'],
      }))
    ).toEqual([
      { tagName: 'button', action: 'current', conflictIndex: '0' },
      { tagName: 'button', action: 'incoming', conflictIndex: '0' },
      { tagName: 'button', action: 'both', conflictIndex: '0' },
    ]);
  });
});
