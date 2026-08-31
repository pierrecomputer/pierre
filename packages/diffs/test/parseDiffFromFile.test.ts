import { describe, expect, test } from 'bun:test';

import type { FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { splitFileContents } from '../src/utils/splitFileContents';
import { fileNew, fileOld } from './mocks';
import { assertDefined, hunkDigest, verifyHunkLineValues } from './testUtils';

describe('parseDiffFromFile', () => {
  const result = parseDiffFromFile(
    { name: 'fileOld.txt', contents: fileOld },
    { name: 'fileNew.txt', contents: fileNew }
  );

  test('should parse diff from fileOld and fileNew and match its digest', () => {
    expect(result.hunks.length).toBeGreaterThan(0);
    expect(result.cacheKey).toBeUndefined();
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
    expect(result.cacheKey).toBeUndefined();
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
    expect(result.cacheKey).toBeUndefined();
  });

  test('uses file cacheKeys when both sides provide them', () => {
    const result = parseDiffFromFile(
      {
        name: 'test.txt',
        contents: 'old\n',
        cacheKey: 'old-cache',
      },
      {
        name: 'test.txt',
        contents: 'new\n',
        cacheKey: 'new-cache',
      }
    );

    expect(result.cacheKey).toBe('ck1:["diff","old-cache","new-cache"]');
  });

  test('encodes caller cache key segments without delimiter collisions', () => {
    const parseWithKeys = (oldCacheKey: string, newCacheKey: string) =>
      parseDiffFromFile(
        {
          name: 'test.txt',
          contents: 'old\n',
          cacheKey: oldCacheKey,
        },
        {
          name: 'test.txt',
          contents: 'new\n',
          cacheKey: newCacheKey,
        }
      ).cacheKey;

    const firstKey = parseWithKeys('a:b', 'c');
    const secondKey = parseWithKeys('a', 'b:c');

    expect(firstKey).not.toBe(secondKey);
    expect(parseWithKeys('a:b', 'c')).toBe(firstKey);
  });

  test('leaves cacheKey unset when either side of a two-sided diff is unkeyed', () => {
    const keyedOldFile: FileContents = {
      name: 'test.txt',
      contents: 'old\n',
      cacheKey: 'old-cache',
    };
    const keyedNewFile: FileContents = {
      name: 'test.txt',
      contents: 'new\n',
      cacheKey: 'new-cache',
    };

    const keyedOldResults = [
      parseDiffFromFile(keyedOldFile, {
        name: 'test.txt',
        contents: 'first unkeyed version\n',
      }),
      parseDiffFromFile(keyedOldFile, {
        name: 'test.txt',
        contents: 'second unkeyed version\n',
      }),
    ];
    const keyedNewResult = parseDiffFromFile(
      { name: 'test.txt', contents: 'unkeyed old version\n' },
      keyedNewFile
    );

    expect(keyedOldResults.map((result) => result.cacheKey)).toEqual([
      undefined,
      undefined,
    ]);
    expect(keyedNewResult.cacheKey).toBeUndefined();
  });

  test('leaves cacheKey unset when file cacheKeys are omitted', () => {
    const result = parseDiffFromFile(
      { name: 'old-name.txt', contents: 'old\n' },
      { name: 'new-name.txt', contents: 'new\n' }
    );

    expect(result.cacheKey).toBeUndefined();
  });

  test('parses a new file from a missing old side', () => {
    const newFile: FileContents = {
      name: 'created.ts',
      contents: 'const created = true;\n',
      lang: 'typescript',
      cacheKey: 'created-cache',
    };

    const result = parseDiffFromFile(null, newFile);

    expect(result.type).toBe('new');
    expect(result.name).toBe('created.ts');
    expect(result.prevName).toBeUndefined();
    expect(result.lang).toBe('typescript');
    expect(result.isPartial).toBe(false);
    expect(result.deletionLines).toEqual([]);
    expect(result.additionLines).toEqual(splitFileContents(newFile.contents));
    expect(result.cacheKey).toBeUndefined();
    expect(verifyHunkLineValues(result)).toEqual([]);
  });

  test('parses a deleted file from a missing new side', () => {
    const oldFile: FileContents = {
      name: 'deleted.ts',
      contents: 'const deleted = true;\n',
      lang: 'typescript',
      cacheKey: 'deleted-cache',
    };

    const result = parseDiffFromFile(oldFile, null);

    expect(result.type).toBe('deleted');
    expect(result.name).toBe('deleted.ts');
    expect(result.prevName).toBeUndefined();
    expect(result.lang).toBe('typescript');
    expect(result.isPartial).toBe(false);
    expect(result.deletionLines).toEqual(splitFileContents(oldFile.contents));
    expect(result.additionLines).toEqual([]);
    expect(result.cacheKey).toBeUndefined();
    expect(verifyHunkLineValues(result)).toEqual([]);
  });

  test('preserves new and deleted intent for empty files', () => {
    const emptyFile: FileContents = {
      name: 'empty.ts',
      contents: '',
    };

    const added = parseDiffFromFile(null, emptyFile);
    const deleted = parseDiffFromFile(emptyFile, null);

    expect(added.type).toBe('new');
    expect(added.cacheKey).toBeUndefined();
    expect(deleted.type).toBe('deleted');
    expect(deleted.cacheKey).toBeUndefined();
  });

  test('throws when both file sides are missing', () => {
    expect(() => parseDiffFromFile(null, null)).toThrow(
      'oldFile, newFile, or both'
    );
  });
});
