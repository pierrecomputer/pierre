import { describe, expect, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';

import type {
  FileContents,
  FileDiffLoadedFiles,
  FileDiffMetadata,
} from '../src/types';
import { hydratePartialDiff } from '../src/utils/hydratePartialDiff';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';
import { splitFileContents } from '../src/utils/splitFileContents';
import { assertDefined, verifyHunkLineValues } from './testUtils';

function parseSingleFile(
  patch: string,
  cacheKeyPrefix?: string
): FileDiffMetadata {
  const file = parsePatchFiles(patch, cacheKeyPrefix, true)[0]?.files[0];
  assertDefined(file, 'expected patch to contain one file');
  expect(file.isPartial).toBe(true);
  return file;
}

interface PartialLineStateAssertions {
  additionLineCount: number;
  deletionLineCount: number;
  fullAdditionLineCount?: number;
  fullDeletionLineCount?: number;
}

function expectPartialLineState(
  fileDiff: FileDiffMetadata,
  {
    additionLineCount,
    deletionLineCount,
    fullAdditionLineCount,
    fullDeletionLineCount,
  }: PartialLineStateAssertions
): void {
  expect(fileDiff.isPartial).toBe(true);
  expect(fileDiff.additionLines.length).toBe(additionLineCount);
  expect(fileDiff.deletionLines.length).toBe(deletionLineCount);
  if (fullAdditionLineCount != null) {
    expect(fileDiff.additionLines.length).not.toBe(fullAdditionLineCount);
  }
  if (fullDeletionLineCount != null) {
    expect(fileDiff.deletionLines.length).not.toBe(fullDeletionLineCount);
  }
}

function expectFirstPartialHunkIndexes(fileDiff: FileDiffMetadata): void {
  const partialFirstHunk = fileDiff.hunks[0];
  const partialFirstContent = partialFirstHunk?.hunkContent[0];
  assertDefined(
    partialFirstHunk,
    'expected partial diff to contain a first hunk'
  );
  assertDefined(
    partialFirstContent,
    'expected first partial hunk to contain content'
  );
  expect(partialFirstHunk.additionLineIndex).toBe(0);
  expect(partialFirstHunk.deletionLineIndex).toBe(0);
  expect(partialFirstContent.additionLineIndex).toBe(0);
  expect(partialFirstContent.deletionLineIndex).toBe(0);
}

describe('hydratePartialDiff', () => {
  test('hydrates two-sided partial diffs with full lines and rewritten line indexes', () => {
    const oldFile: FileContents = {
      name: 'two-sided.txt',
      cacheKey: 'old-full',
      contents: [
        'keep 1\n',
        'keep 2\n',
        'old first\n',
        'keep 4\n',
        'keep 5\n',
        'keep 6\n',
        'keep 7\n',
        'keep 8\n',
        'old second\n',
        'keep 10\n',
        'keep 11\n',
      ].join(''),
    };
    const newFile: FileContents = {
      name: 'two-sided.txt',
      cacheKey: 'new-full',
      contents: [
        'keep 1\n',
        'keep 2\n',
        'new first\n',
        'keep 4\n',
        'keep 5\n',
        'keep 6\n',
        'keep 7\n',
        'keep 8\n',
        'new second\n',
        'keep 10\n',
        'keep 11\n',
      ].join(''),
    };
    const partial = parseSingleFile(
      createTwoFilesPatch(
        oldFile.name,
        newFile.name,
        oldFile.contents,
        newFile.contents,
        undefined,
        undefined,
        { context: 1 }
      )
    );
    partial.cacheKey = 'partial-cache';
    partial.lang = 'typescript';
    partial.mode = '100644';
    partial.prevObjectId = '1111111';
    partial.newObjectId = '2222222';
    const oldFileLines = splitFileContents(oldFile.contents);
    const newFileLines = splitFileContents(newFile.contents);
    const partialHunkSpecs = partial.hunks.map((hunk) => hunk.hunkSpecs);

    expectPartialLineState(partial, {
      additionLineCount: 6,
      deletionLineCount: 6,
      fullAdditionLineCount: newFileLines.length,
      fullDeletionLineCount: oldFileLines.length,
    });
    expectFirstPartialHunkIndexes(partial);

    const hydrated = hydratePartialDiff('merge', partial, { oldFile, newFile });
    const firstHunk = hydrated.hunks[0];
    const firstContent = firstHunk?.hunkContent[0];

    assertDefined(firstHunk, 'expected hydrated diff to contain a first hunk');
    assertDefined(firstContent, 'expected first hunk to contain content');
    expect(hydrated).toBe(partial);
    expect(hydrated.isPartial).toBe(false);
    expect(hydrated.type).toBe('change');
    expect(hydrated.lang).toBe('typescript');
    expect(hydrated.mode).toBe('100644');
    expect(hydrated.prevObjectId).toBe('1111111');
    expect(hydrated.newObjectId).toBe('2222222');
    expect(hydrated.cacheKey).toBe('partial-cache:hydrated');
    expect(hydrated.additionLines).toEqual(newFileLines);
    expect(hydrated.deletionLines).toEqual(oldFileLines);
    expect(hydrated.hunks.map((hunk) => hunk.hunkSpecs)).toEqual(
      partialHunkSpecs
    );
    expect(firstHunk.additionLineIndex).toBe(firstHunk.additionStart - 1);
    expect(firstHunk.deletionLineIndex).toBe(firstHunk.deletionStart - 1);
    expect(firstContent.additionLineIndex).toBe(firstHunk.additionStart - 1);
    expect(firstContent.deletionLineIndex).toBe(firstHunk.deletionStart - 1);
    expect(verifyHunkLineValues(hydrated)).toEqual([]);
  });

  test('uses loaded file cache keys without a partial cache key', () => {
    const oldFile: FileContents = {
      name: 'unkeyed.txt',
      cacheKey: 'old-full',
      contents: 'old value\n',
    };
    const newFile: FileContents = {
      name: 'unkeyed.txt',
      cacheKey: 'new-full',
      contents: 'new value\n',
    };
    const partial = parseSingleFile(
      createTwoFilesPatch(
        oldFile.name,
        newFile.name,
        oldFile.contents,
        newFile.contents,
        undefined,
        undefined,
        { context: 0 }
      )
    );

    const hydrated = hydratePartialDiff('merge', partial, { oldFile, newFile });

    expect(hydrated).toBe(partial);
    expect(hydrated.cacheKey).toBe('old-full:new-full');
  });

  test('does not use one loaded file cache key for a two-sided diff', () => {
    const oldFile: FileContents = {
      name: 'one-keyed-side.txt',
      cacheKey: 'old-full',
      contents: 'old value\n',
    };
    const newFile: FileContents = {
      name: 'one-keyed-side.txt',
      contents: 'new value\n',
    };
    const partial = parseSingleFile(
      createTwoFilesPatch(
        oldFile.name,
        newFile.name,
        oldFile.contents,
        newFile.contents,
        undefined,
        undefined,
        { context: 0 }
      )
    );

    const hydrated = hydratePartialDiff('merge', partial, { oldFile, newFile });

    expect(hydrated).toBe(partial);
    expect(hydrated.cacheKey).toBeUndefined();
  });

  test('can hydrate a cloned metadata object without mutating the source diff', () => {
    const oldFile: FileContents = {
      name: 'cloned.txt',
      cacheKey: 'old-full',
      contents: 'keep 1\nold value\nkeep 3\n',
    };
    const newFile: FileContents = {
      name: 'cloned.txt',
      cacheKey: 'new-full',
      contents: 'keep 1\nnew value\nkeep 3\n',
    };
    const partial = parseSingleFile(
      createTwoFilesPatch(
        oldFile.name,
        newFile.name,
        oldFile.contents,
        newFile.contents,
        undefined,
        undefined,
        { context: 0 }
      )
    );

    const hydrated = hydratePartialDiff('clone', partial, { oldFile, newFile });

    expect(hydrated).not.toBe(partial);
    expect(hydrated.isPartial).toBe(false);
    expect(hydrated.additionLines).toEqual([
      'keep 1\n',
      'new value\n',
      'keep 3\n',
    ]);
    expect(hydrated.deletionLines).toEqual([
      'keep 1\n',
      'old value\n',
      'keep 3\n',
    ]);
    expect(partial.isPartial).toBe(true);
    expect(partial.additionLines).toEqual(['new value\n']);
    expect(partial.deletionLines).toEqual(['old value\n']);
  });

  test('falls back to a hydrated cache segment when loaded files are unkeyed', () => {
    const oldFile: FileContents = {
      name: 'fallback.txt',
      contents: 'old value\n',
    };
    const newFile: FileContents = {
      name: 'fallback.txt',
      contents: 'new value\n',
    };
    const partial = parseSingleFile(
      createTwoFilesPatch(
        oldFile.name,
        newFile.name,
        oldFile.contents,
        newFile.contents,
        undefined,
        undefined,
        { context: 0 }
      )
    );
    partial.cacheKey = 'partial-cache';

    const hydrated = hydratePartialDiff('merge', partial, { oldFile, newFile });

    expect(hydrated).toBe(partial);
    expect(hydrated.cacheKey).toBe('partial-cache:hydrated');
  });

  test('requires both files for rename-changed diffs and preserves rename metadata', () => {
    const oldFile: FileContents = {
      name: 'old-name.ts',
      contents: ['same 1\n', 'same 2\n', 'old value\n', 'same 4\n'].join(''),
    };
    const newFile: FileContents = {
      name: 'new-name.ts',
      contents: ['same 1\n', 'same 2\n', 'new value\n', 'same 4\n'].join(''),
    };
    const partial = parseSingleFile(
      createTwoFilesPatch(
        oldFile.name,
        newFile.name,
        oldFile.contents,
        newFile.contents,
        undefined,
        undefined,
        { context: 0 }
      )
    );
    partial.type = 'rename-changed';
    partial.prevName = oldFile.name;
    partial.name = newFile.name;
    const oldFileLines = splitFileContents(oldFile.contents);
    const newFileLines = splitFileContents(newFile.contents);

    expectPartialLineState(partial, {
      additionLineCount: 1,
      deletionLineCount: 1,
      fullAdditionLineCount: newFileLines.length,
      fullDeletionLineCount: oldFileLines.length,
    });
    expectFirstPartialHunkIndexes(partial);
    expect(() =>
      hydratePartialDiff('merge', partial, {
        oldFile,
        newFile: null,
      } as unknown as FileDiffLoadedFiles)
    ).toThrow('requires newFile');
    expect(() =>
      hydratePartialDiff('merge', partial, { oldFile: null, newFile })
    ).toThrow('requires oldFile');

    const hydrated = hydratePartialDiff('merge', partial, { oldFile, newFile });

    expect(hydrated).toBe(partial);
    expect(hydrated.type).toBe('rename-changed');
    expect(hydrated.prevName).toBe(oldFile.name);
    expect(hydrated.name).toBe(newFile.name);
    expect(hydrated.isPartial).toBe(false);
    expect(hydrated.additionLines).toEqual(newFileLines);
    expect(hydrated.deletionLines).toEqual(oldFileLines);
    expect(verifyHunkLineValues(hydrated)).toEqual([]);
  });

  test('rejects added partial diffs', () => {
    const addedPartial = parseSingleFile(
      [
        'diff --git a/new-file.txt b/new-file.txt\n',
        'new file mode 100644\n',
        'index 0000000..1111111\n',
        '--- /dev/null\n',
        '+++ b/new-file.txt\n',
        '@@ -0,0 +1,2 @@\n',
        '+alpha\n',
        '+beta\n',
      ].join('')
    );
    const newFile: FileContents = {
      name: 'new-file.txt',
      contents: 'alpha\nbeta\ngamma\ndelta\n',
      cacheKey: 'new-full',
    };
    expect(() =>
      hydratePartialDiff('merge', addedPartial, { oldFile: null, newFile })
    ).toThrow('new diffs cannot be hydrated from loaded files');
    expect(addedPartial.isPartial).toBe(true);
  });

  test('hydrates pure renames as data-only line arrays', () => {
    const partial = parseSingleFile(
      [
        'diff --git a/old-name.txt b/new-name.txt\n',
        'similarity index 100%\n',
        'rename from old-name.txt\n',
        'rename to new-name.txt\n',
      ].join('')
    );
    partial.cacheKey = 'partial-rename-cache';
    const newFile: FileContents = {
      name: 'new-name.txt',
      contents: 'alpha\nbeta\n',
      cacheKey: 'new-full',
    };
    const newFileLines = splitFileContents(newFile.contents);

    expectPartialLineState(partial, {
      additionLineCount: 0,
      deletionLineCount: 0,
      fullAdditionLineCount: newFileLines.length,
      fullDeletionLineCount: newFileLines.length,
    });
    expect(partial.hunks).toEqual([]);
    expect(() =>
      hydratePartialDiff('merge', partial, {
        oldFile: { name: 'old-name.txt', contents: newFile.contents },
        newFile,
      })
    ).toThrow('requires oldFile to be null');

    const hydrated = hydratePartialDiff('merge', partial, {
      oldFile: null,
      newFile,
    });

    expect(hydrated).toBe(partial);
    expect(hydrated.type).toBe('rename-pure');
    expect(hydrated.name).toBe('new-name.txt');
    expect(hydrated.prevName).toBe('old-name.txt');
    expect(hydrated.isPartial).toBe(false);
    expect(hydrated.hunks).toEqual([]);
    expect(hydrated.splitLineCount).toBe(0);
    expect(hydrated.unifiedLineCount).toBe(0);
    expect(hydrated.additionLines).toEqual(newFileLines);
    expect(hydrated.deletionLines).toEqual(newFileLines);
    expect(hydrated.cacheKey).toBe('partial-rename-cache:hydrated');
  });
});
