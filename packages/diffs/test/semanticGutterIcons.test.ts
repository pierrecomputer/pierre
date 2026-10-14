import { afterAll, describe, expect, test } from 'bun:test';
import type { ElementContent } from 'hast';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  parseDiffFromFile,
} from '../src';
import type { SemanticDiffOperation } from '../src/types';
import { inlinedFunctionDiff } from './mocks';
import { assertDefined, collectAllElements } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

// Each gutter icon in a column, in row order, as its line number and the
// sprite symbol it draws.
function gutterIcons(gutter: ElementContent[] | undefined): unknown[][] {
  assertDefined(gutter, 'gutter AST should be defined');
  return collectAllElements(gutter)
    .filter((node) => 'data-column-number' in node.properties)
    .flatMap((cell) =>
      collectAllElements(cell.children)
        .filter((node) => 'data-semantic-icon' in node.properties)
        .map((icon) => {
          const use = collectAllElements(icon.children).find(
            (node) => node.tagName === 'use'
          );
          return [cell.properties['data-column-number'], use?.properties.href];
        })
    );
}

function renderInlinedFunction(
  diffStyle: 'split' | 'unified',
  semanticOperations: SemanticDiffOperation[] | undefined
) {
  const { oldContents, newContents } = inlinedFunctionDiff;
  const fileDiff = parseDiffFromFile(
    { name: 'ops.go', contents: oldContents },
    { name: 'ops.go', contents: newContents }
  );
  fileDiff.semanticOperations = semanticOperations;
  return new DiffHunksRenderer({ diffStyle }).asyncRender(fileDiff);
}

describe('semantic gutter icons', () => {
  test('split view marks the first row of each region, tinted on the old side and solid on the new side', async () => {
    const result = await renderInlinedFunction('split', [
      inlinedFunctionDiff.operation,
    ]);
    expect(gutterIcons(result.deletionsGutterAST)).toEqual([
      [13, '#diffs-icon-symbol-modified-duo'],
      [18, '#diffs-icon-symbol-deleted-duo'],
      [20, '#diffs-icon-symbol-inlined-duo'],
    ]);
    expect(gutterIcons(result.additionsGutterAST)).toEqual([
      [13, '#diffs-icon-symbol-inlined-fill'],
      [15, '#diffs-icon-symbol-modified-fill'],
    ]);
  });

  test('unified view marks the same rows, each with its own side', async () => {
    const result = await renderInlinedFunction('unified', [
      inlinedFunctionDiff.operation,
    ]);
    // Old line 13 and new lines 13-15 form one change block, which lists its
    // deletions before its additions.
    expect(gutterIcons(result.unifiedGutterAST)).toEqual([
      [13, '#diffs-icon-symbol-modified-duo'],
      [13, '#diffs-icon-symbol-inlined-fill'],
      [15, '#diffs-icon-symbol-modified-fill'],
      [18, '#diffs-icon-symbol-deleted-duo'],
      [20, '#diffs-icon-symbol-inlined-duo'],
    ]);
  });

  test('reformatted rows use the eye-slash icon on both sides', async () => {
    const fileDiff = parseDiffFromFile(
      { name: 'a.css', contents: 'a {\n  color: red\n}\n' },
      { name: 'a.css', contents: 'a {\n  color:red\n}\n' }
    );
    fileDiff.semanticOperations = [
      {
        type: 'reformatted',
        spans: [
          {
            role: 'root',
            relation: 'mapped',
            old: [],
            new: [],
            linePairs: [
              { old: { start: 2, end: 2 }, new: { start: 2, end: 2 } },
            ],
          },
        ],
        lines: {
          old: [{ start: 2, end: 2, spanIndex: 0 }],
          new: [{ start: 2, end: 2, spanIndex: 0 }],
        },
      },
    ];
    const result = await new DiffHunksRenderer({
      diffStyle: 'split',
    }).asyncRender(fileDiff);
    expect(gutterIcons(result.deletionsGutterAST)).toEqual([
      [2, '#diffs-icon-eye-slash'],
    ]);
    expect(gutterIcons(result.additionsGutterAST)).toEqual([
      [2, '#diffs-icon-eye-slash'],
    ]);
  });

  test('a diff without semantic data has no icons', async () => {
    const split = await renderInlinedFunction('split', undefined);
    expect(gutterIcons(split.deletionsGutterAST)).toEqual([]);
    expect(gutterIcons(split.additionsGutterAST)).toEqual([]);
    const unified = await renderInlinedFunction('unified', undefined);
    expect(gutterIcons(unified.unifiedGutterAST)).toEqual([]);
  });
});
