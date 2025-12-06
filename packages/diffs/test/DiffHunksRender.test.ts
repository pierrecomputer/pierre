import { describe, expect, test } from 'bun:test';
import { DiffHunksRenderer, parseDiffFromFile } from 'src';

import { mockDiffs } from './mocks';

describe('DiffHunksRenderer', () => {
  test('proper buffers should be prepended to additions colum in split style', async () => {
    const instance = new DiffHunksRenderer(mockDiffs.diffRowBufferTest.options);
    const diff = parseDiffFromFile(
      mockDiffs.diffRowBufferTest.oldFile,
      mockDiffs.diffRowBufferTest.newFile
    );
    const result = await instance.asyncRender(diff);
    expect(result.additionsAST).toBeDefined();
    expect(result.deletionsAST).toBeDefined();
    expect(result.unifiedAST).toBeUndefined();
    expect(result).toMatchSnapshot();
  });

  test('proper buffers should be prepended to deletions colum in split style', async () => {
    const instance = new DiffHunksRenderer(mockDiffs.diffRowBufferTest.options);
    const diff = parseDiffFromFile(
      mockDiffs.diffRowBufferTest.newFile,
      mockDiffs.diffRowBufferTest.oldFile
    );
    const result = await instance.asyncRender(diff);
    expect(result.additionsAST).toBeDefined();
    expect(result.deletionsAST).toBeDefined();
    expect(result.unifiedAST).toBeUndefined();
    expect(result).toMatchSnapshot();
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
    const result = await instance.asyncRender(diff);
    expect(result.additionsAST).toBeUndefined();
    expect(result.deletionsAST).toBeUndefined();
    expect(result.unifiedAST).toBeDefined();
  });

  test('a diff with only additions should have an empty deletions column', async () => {
    const instance = new DiffHunksRenderer(mockDiffs.diffRowBufferTest.options);
    const diff = parseDiffFromFile(
      { ...mockDiffs.diffRowBufferTest.oldFile, contents: '' },
      mockDiffs.diffRowBufferTest.newFile
    );
    const result = await instance.asyncRender(diff);
    expect(result.preNode.properties?.['data-type']).toBe('file');
    expect(result.additionsAST).toBeDefined();
    expect(result.deletionsAST).toBeUndefined();
    expect(result.unifiedAST).toBeUndefined();
    expect(result).toMatchSnapshot();
  });

  test('a diff with only deletions should have an empty additions column', async () => {
    const instance = new DiffHunksRenderer(mockDiffs.diffRowBufferTest.options);
    const diff = parseDiffFromFile(mockDiffs.diffRowBufferTest.oldFile, {
      ...mockDiffs.diffRowBufferTest.newFile,
      contents: '',
    });
    const result = await instance.asyncRender(diff);
    expect(result.preNode.properties?.['data-type']).toBe('file');
    expect(result.deletionsAST).toBeDefined();
    expect(result.additionsAST).toBeUndefined();
    expect(result.unifiedAST).toBeUndefined();
    expect(result).toMatchSnapshot();
  });
});
