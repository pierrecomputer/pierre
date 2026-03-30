import { describe, expect, test } from 'bun:test';

import { DiffHunksRenderer, parseDiffFromFile } from '../src';
import { mockDiffs } from './mocks';
import { assertDefined, collectAllElements, countSplitRows } from './testUtils';

function countInlineDiffSpans(
  result: Awaited<ReturnType<DiffHunksRenderer['asyncRender']>>
) {
  const additions = result.additionsContentAST ?? [];
  const deletions = result.deletionsContentAST ?? [];
  return [
    ...collectAllElements(additions),
    ...collectAllElements(deletions),
  ].filter((element) => element.properties?.['data-diff-span'] != null).length;
}

describe('DiffHunksRenderer', () => {
  test('proper buffers should be prepended to additions colum in split style', async () => {
    const instance = new DiffHunksRenderer(mockDiffs.diffRowBufferTest.options);
    const diff = parseDiffFromFile(
      mockDiffs.diffRowBufferTest.oldFile,
      mockDiffs.diffRowBufferTest.newFile
    );
    expect(diff).toMatchSnapshot('parsed diff');
    const result = await instance.asyncRender(diff);
    assertDefined(
      result.additionsContentAST,
      'result.additionsContentAST should be defined'
    );
    assertDefined(
      result.deletionsContentAST,
      'result.deletionsContentAST should be defined'
    );
    expect(result.unifiedContentAST).toBeUndefined();
    expect(result).toMatchSnapshot('rendered result');
  });

  test('proper buffers should be prepended to deletions colum in split style', async () => {
    const instance = new DiffHunksRenderer(mockDiffs.diffRowBufferTest.options);
    const diff = parseDiffFromFile(
      mockDiffs.diffRowBufferTest.newFile,
      mockDiffs.diffRowBufferTest.oldFile
    );
    expect(diff).toMatchSnapshot('parsed diff');
    const result = await instance.asyncRender(diff);
    assertDefined(
      result.additionsContentAST,
      'result.additionsContentAST should be defined'
    );
    assertDefined(
      result.deletionsContentAST,
      'result.deletionsContentAST should be defined'
    );
    expect(result.unifiedContentAST).toBeUndefined();
    expect(result).toMatchSnapshot('rendered result');
  });

  test('additions and deletions should be empty when unified', async () => {
    const instance = new DiffHunksRenderer({
      ...mockDiffs.diffRowBufferTest.options,
      diffStyle: 'unified',
    });
    const diff = parseDiffFromFile(
      mockDiffs.diffRowBufferTest.oldFile,
      mockDiffs.diffRowBufferTest.newFile
    );
    expect(diff).toMatchSnapshot('parsed diff');
    const result = await instance.asyncRender(diff);
    expect(result.additionsContentAST).toBeUndefined();
    expect(result.deletionsContentAST).toBeUndefined();
    assertDefined(
      result.unifiedContentAST,
      'result.unifiedContentAST should be defined'
    );
    expect(result).toMatchSnapshot('rendered result');
  });

  test('a diff with only additions should have an empty deletions column', async () => {
    const instance = new DiffHunksRenderer(mockDiffs.diffRowBufferTest.options);
    const diff = parseDiffFromFile(
      { ...mockDiffs.diffRowBufferTest.oldFile, contents: '' },
      mockDiffs.diffRowBufferTest.newFile
    );
    expect(diff.hunks[0]?.collapsedBefore).toBe(0);
    expect(diff).toMatchSnapshot('parsed diff');
    const result = await instance.asyncRender(diff);
    expect(result.preNode.properties?.['data-diff-type']).toBe('single');
    assertDefined(
      result.additionsContentAST,
      'result.additionsContentAST should be defined'
    );
    expect(countSplitRows(result)).toBe(diff.splitLineCount);
    expect(result.deletionsContentAST).toBeUndefined();
    expect(result.unifiedContentAST).toBeUndefined();
    expect(result).toMatchSnapshot('rendered result');
  });

  test('a diff with only deletions should have an empty additions column', async () => {
    const instance = new DiffHunksRenderer(mockDiffs.diffRowBufferTest.options);
    const diff = parseDiffFromFile(mockDiffs.diffRowBufferTest.oldFile, {
      ...mockDiffs.diffRowBufferTest.newFile,
      contents: '',
    });
    expect(diff.hunks[0]?.collapsedBefore).toBe(0);
    expect(diff).toMatchSnapshot('parsed diff');
    const result = await instance.asyncRender(diff);
    expect(result.preNode.properties?.['data-diff-type']).toBe('single');
    assertDefined(
      result.deletionsContentAST,
      'result.deletionsContentAST should be defined'
    );
    expect(countSplitRows(result)).toBe(diff.splitLineCount);
    expect(result.additionsContentAST).toBeUndefined();
    expect(result.unifiedContentAST).toBeUndefined();
    expect(result).toMatchSnapshot('rendered result');
  });

  test('adds data-container-size for line-info separators', async () => {
    const instance = new DiffHunksRenderer({ hunkSeparators: 'line-info' });
    const diff = parseDiffFromFile(
      mockDiffs.diffRowBufferTest.oldFile,
      mockDiffs.diffRowBufferTest.newFile
    );
    const result = await instance.asyncRender(diff);
    const html = instance.renderFullHTML(result);
    expect(html).toContain('data-container-size');
  });

  test('does not add data-container-size for non line-info separators', async () => {
    const instance = new DiffHunksRenderer({
      hunkSeparators: 'line-info-basic',
    });
    const diff = parseDiffFromFile(
      mockDiffs.diffRowBufferTest.oldFile,
      mockDiffs.diffRowBufferTest.newFile
    );
    const result = await instance.asyncRender(diff);
    const html = instance.renderFullHTML(result);
    expect(html).not.toContain('data-container-size');
  });

  test('skips inline diff decorations for changed lines above maxLineDiffLength', async () => {
    const instance = new DiffHunksRenderer({
      diffStyle: 'split',
      maxLineDiffLength: 5,
    });
    const diff = parseDiffFromFile(
      {
        name: 'example.ts',
        contents: 'const value = "aaaaaaaaaaaa";\n',
      },
      {
        name: 'example.ts',
        contents: 'const value = "bbbbbbbbbbbb";\n',
      }
    );
    const result = await instance.asyncRender(diff);

    expect(countInlineDiffSpans(result)).toBe(0);
    expect(result).toMatchSnapshot('rendered result without inline diff spans');
  });

  test('keeps inline diff decorations for changed lines below maxLineDiffLength', async () => {
    const instance = new DiffHunksRenderer({
      diffStyle: 'split',
      maxLineDiffLength: 50,
    });
    const diff = parseDiffFromFile(
      {
        name: 'example.ts',
        contents: 'const x = 1;\n',
      },
      {
        name: 'example.ts',
        contents: 'const x = 2;\n',
      }
    );
    const result = await instance.asyncRender(diff);

    expect(countInlineDiffSpans(result)).toBeGreaterThan(0);
    expect(result).toMatchSnapshot('rendered result with inline diff spans');
  });
});
