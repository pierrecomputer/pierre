import { describe, expect, test } from 'bun:test';

import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { fileNew, fileOld } from './mocks';
import { assertDefined, hunkDigest, verifyHunkLineValues } from './testUtils';

describe('parseDiffFromFile', () => {
  const result = parseDiffFromFile(
    { name: 'fileOld.txt', contents: fileOld },
    { name: 'fileNew.txt', contents: fileNew }
  );

  test('should parse diff from fileOld and fileNew and match its digest', () => {
    expect(result.hunks.length).toBeGreaterThan(0);
    // Compact geometry lock; line-level accuracy is covered by the invariant
    // test below and the renderer's content tests
    expect(hunkDigest(result)).toMatchSnapshot('parsed diff digest');
  });

  test('should have accurate hunk line values', () => {
    expect(verifyHunkLineValues(result)).toEqual([]);
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

  test('ignoreWhitespace hides leading/trailing whitespace changes', () => {
    const oldFile = {
      name: 'test.txt',
      contents: 'hello world\nfoo bar\n',
    };
    const newFile = {
      name: 'test.txt',
      contents: '  hello world\nfoo bar\n',
    };

    const withWhitespace = parseDiffFromFile(oldFile, newFile);
    expect(withWhitespace.hunks.length).toBeGreaterThan(0);

    const withoutWhitespace = parseDiffFromFile(oldFile, newFile, {
      ignoreWhitespace: true,
    });
    expect(withoutWhitespace.hunks).toHaveLength(0);
  });

  test('should have type "change" (default) when files did not change', () => {
    const oldFile = {
      name: 'test.txt',
      contents: 'abc',
    };
    const newFile = {
      name: 'test.txt',
      contents: 'abc',
    };

    const result = parseDiffFromFile(oldFile, newFile);
    expect(result.type).toBe('change');
  });

  test('should have type "change" (default) when empty files did not change', () => {
    const oldFile = {
      name: 'test.txt',
      contents: '',
    };
    const newFile = {
      name: 'test.txt',
      contents: '',
    };

    const result = parseDiffFromFile(oldFile, newFile);
    expect(result.type).toBe('change');
  });
});
