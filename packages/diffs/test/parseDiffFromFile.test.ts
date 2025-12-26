import { describe, expect, test } from 'bun:test';

import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { fileNew, fileOld } from './mocks';
import { assertDefined, verifyFileDiffHunkValues } from './testUtils';

describe('parseDiffFromFile', () => {
  const result = parseDiffFromFile(
    { name: 'fileOld.txt', contents: fileOld },
    { name: 'fileNew.txt', contents: fileNew }
  );

  test('should parse diff from fileOld and fileNew and match snapshot', () => {
    expect(result.hunks.length).toBeGreaterThan(0);
    expect(result).toMatchSnapshot();
  });

  test('should have accurate hunk line values', () => {
    const { valid, errors } = verifyFileDiffHunkValues(result);
    if (!valid) {
      console.error('Hunk line value errors:', errors);
    }
    expect(valid).toBe(true);
  });

  test('should correctly set oldLines and newLines', () => {
    assertDefined(result.deletionLines, 'result.oldLines should be defined');
    assertDefined(result.additionLines, 'result.newLines should be defined');

    // oldLines should match the split of fileOld
    const expectedOldLineCount = fileOld.split(/(?<=\n)/).length;
    expect(result.deletionLines.length).toBe(expectedOldLineCount);

    // newLines should match the split of fileNew
    const expectedNewLineCount = fileNew.split(/(?<=\n)/).length;
    expect(result.additionLines.length).toBe(expectedNewLineCount);
  });
});
