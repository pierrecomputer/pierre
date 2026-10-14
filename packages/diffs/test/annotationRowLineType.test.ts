import { afterAll, describe, expect, test } from 'bun:test';
import type { ElementContent } from 'hast';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  parseDiffFromFile,
} from '../src';
import type { DiffLineAnnotation, FileDiffMetadata } from '../src/types';
import { inlinedFunctionDiff } from './mocks';
import { assertDefined, collectAllElements } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

// The line type of each annotation gutter cell in a column, in row order.
function annotationGutterLineTypes(
  gutter: ElementContent[] | undefined
): unknown[] {
  assertDefined(gutter, 'gutter AST should be defined');
  return collectAllElements(gutter)
    .filter((node) => node.properties['data-gutter-buffer'] === 'annotation')
    .map((node) => node.properties['data-line-type']);
}

// The line type of each annotation content row in a column, in row order.
function annotationRowLineTypes(
  content: ElementContent[] | undefined
): unknown[] {
  assertDefined(content, 'content AST should be defined');
  return collectAllElements(content)
    .filter((node) => 'data-line-annotation' in node.properties)
    .map((node) => node.properties['data-line-type']);
}

function render(
  fileDiff: FileDiffMetadata,
  diffStyle: 'split' | 'unified',
  annotations: DiffLineAnnotation<string>[]
) {
  const renderer = new DiffHunksRenderer<string>({ diffStyle });
  renderer.setLineAnnotations(annotations);
  return renderer.asyncRender(fileDiff);
}

describe('annotation row line type', () => {
  // Line 2 changes; line 1 is context.
  const plainDiff = () =>
    parseDiffFromFile(
      { name: 'a.txt', contents: 'one\ntwo\nthree\n' },
      { name: 'a.txt', contents: 'one\nTWO\nthree\n' }
    );

  test('continues the line above it in a plain split diff, spacers included', async () => {
    const result = await render(plainDiff(), 'split', [
      { side: 'deletions', lineNumber: 1, metadata: 'context' },
      { side: 'deletions', lineNumber: 2, metadata: 'deleted' },
    ]);
    // Each annotated row also gets an empty spacer in the other column.
    expect(annotationGutterLineTypes(result.deletionsGutterAST)).toEqual([
      'context',
      'change-deletion',
    ]);
    expect(annotationGutterLineTypes(result.additionsGutterAST)).toEqual([
      'context',
      'change-addition',
    ]);
    expect(annotationRowLineTypes(result.deletionsContentAST)).toEqual([
      'context',
      'change-deletion',
    ]);
    expect(annotationRowLineTypes(result.additionsContentAST)).toEqual([
      'context',
      'change-addition',
    ]);
  });

  test('continues the line above it in a unified diff', async () => {
    const result = await render(plainDiff(), 'unified', [
      { side: 'deletions', lineNumber: 2, metadata: 'deleted' },
      { side: 'additions', lineNumber: 2, metadata: 'added' },
    ]);
    expect(annotationGutterLineTypes(result.unifiedGutterAST)).toEqual([
      'change-deletion',
      'change-addition',
    ]);
    expect(annotationRowLineTypes(result.unifiedContentAST)).toEqual([
      'change-deletion',
      'change-addition',
    ]);
  });

  test('takes the semantic line type, and none under a gap row', async () => {
    const { oldContents, newContents, operation } = inlinedFunctionDiff;
    const fileDiff = parseDiffFromFile(
      { name: 'ops.go', contents: oldContents },
      { name: 'ops.go', contents: newContents }
    );
    fileDiff.semanticOperations = [operation];
    // New 13 shares its row with old 13 (the replaced call); new 14 sits next
    // to a gap row on the old side.
    const result = await render(fileDiff, 'split', [
      { side: 'additions', lineNumber: 13, metadata: 'inlined body' },
      { side: 'additions', lineNumber: 14, metadata: 'inlined body' },
    ]);
    expect(annotationGutterLineTypes(result.additionsGutterAST)).toEqual([
      'change-inlined-function',
      'change-inlined-function',
    ]);
    expect(annotationGutterLineTypes(result.deletionsGutterAST)).toEqual([
      'change-edited',
      undefined,
    ]);
    expect(annotationRowLineTypes(result.deletionsContentAST)).toEqual([
      'change-edited',
      undefined,
    ]);
    expect(annotationRowLineTypes(result.additionsContentAST)).toEqual([
      'change-inlined-function',
      'change-inlined-function',
    ]);
  });
});
