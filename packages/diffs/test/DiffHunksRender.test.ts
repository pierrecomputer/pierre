import { describe, expect, test } from 'bun:test';
import { DiffHunksRenderer, parseDiffFromFile } from 'src';

import { mockDiffs } from './mocks';

describe('DiffHunksRenderer', () => {
  test('proper buffers should be prepended to additions colum', async () => {
    const instance = new DiffHunksRenderer(mockDiffs.diffRowBufferTest.options);
    const diff = parseDiffFromFile(
      mockDiffs.diffRowBufferTest.oldFile,
      mockDiffs.diffRowBufferTest.newFile
    );
    const result = await instance.asyncRender(diff);
    expect(result).toMatchSnapshot();
  });
});
