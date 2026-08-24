import { afterAll, describe, expect, spyOn, test } from 'bun:test';

import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { getTotalLineCountFromHunks } from '../src/utils/getTotalLineCountFromHunks';
import { parsePatchFiles, processFile } from '../src/utils/parsePatchFiles';
import {
  diffPatch,
  finalBlankLinePatch,
  formatPatchWithVersionTrailer,
  malformedPatch,
} from './mocks';
import {
  assertDefined,
  countRenderedLines,
  countSplitRows,
  patchDigest,
  verifyPatchHunkValues,
} from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

const issue1094Patch = [
  '--- f\n',
  '+++ f\n',
  '@@ -1,6 +1,6 @@\n',
  '-a\n',
  '+A\n',
  ' c0\n',
  ' c1\n',
  '-b\n',
  '+B\n',
].join('');

const validIssue1094Patch = issue1094Patch.replace(
  '@@ -1,6 +1,6 @@',
  '@@ -1,4 +1,4 @@'
);

describe('parsePatchFiles', () => {
  const result = parsePatchFiles(diffPatch);
  test('should parse diff.patch and match its digest snapshot', () => {
    // Per-file hunk geometry of the whole 400KB patch; line-level accuracy
    // is covered by the invariant and render-count tests below
    expect(patchDigest(result)).toMatchSnapshot('git pr patch digest');
  });

  test('patches with a final blank line should have a \\n added', () => {
    const result = parsePatchFiles(finalBlankLinePatch);
    expect(result).toMatchSnapshot('final blank line patch');
  });

  test('should have accurate hunk line values', () => {
    expect(verifyPatchHunkValues(result).errors).toEqual([]);
  });

  test('should warn on malformed patch with bare newline in hunk', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(
      (...args: unknown[]) => {
        console.log('  * test expected console.error:', args);
      }
    );
    try {
      const result = parsePatchFiles(malformedPatch);

      // Should have logged an error for the invalid line, but should still try
      // to do its best to parse things out
      expect(consoleError).toHaveBeenCalled();
      expect(consoleError.mock.calls[0][0]).toContain('Invalid firstChar');

      // The declared count should be repaired to match the usable hunk body.
      const hunk = result[0].files[0].hunks[0];
      expect(hunk.deletionCount).toBe(86);
      expect(hunk.deletionLines).toBe(86);
      expect(verifyPatchHunkValues(result).errors).toEqual([]);
      expect(result).toMatchSnapshot('malformed patch');
    } finally {
      consoleError.mockRestore();
    }
  });

  test('throws in strict mode for malformed patch with bare newline in hunk', () => {
    expect(() => parsePatchFiles(malformedPatch, undefined, true)).toThrow(
      'invalid hunk line'
    );
  });

  test('throws in strict mode when a hunk has too few lines', () => {
    expect(() =>
      parsePatchFiles(
        [
          '--- incomplete.txt\n',
          '+++ incomplete.txt\n',
          '@@ -1 +1 @@\n',
          '-old line\n',
        ].join(''),
        undefined,
        true
      )
    ).toThrow('hunk line count mismatch');
  });

  test('repairs issue 1094 hunk counts in forgiving mode', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = parsePatchFiles(issue1094Patch);
      const file = result[0].files[0];
      const hunk = file.hunks[0];

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0][0]).toContain(
        'parsePatchContent: hunk line count mismatch'
      );
      expect(consoleError.mock.calls[0][0]).toContain('@@ -1,6 +1,6 @@');
      expect(consoleError.mock.calls[0][0]).toContain('declared old/new 6/6');
      expect(consoleError.mock.calls[0][0]).toContain('parsed old/new 4/4');
      expect(hunk.additionCount).toBe(4);
      expect(hunk.deletionCount).toBe(4);
      expect(file.additionLines).toEqual(['A\n', 'c0\n', 'c1\n', 'B\n']);
      expect(file.deletionLines).toEqual(['a\n', 'c0\n', 'c1\n', 'b\n']);
      expect(hunk.hunkContent.map((content) => content.type)).toEqual([
        'change',
        'context',
        'change',
      ]);
      expect(hunk.hunkSpecs).toBe('@@ -1,6 +1,6 @@\n');
      expect(getTotalLineCountFromHunks(file.hunks)).toBe(4);
      expect(verifyPatchHunkValues(result).errors).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  test('throws for the issue 1094 patch in strict mode', () => {
    expect(() => parsePatchFiles(issue1094Patch, undefined, true)).toThrow(
      'hunk line count mismatch'
    );
  });

  test('leaves the valid issue 1094 patch unchanged', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = parsePatchFiles(validIssue1094Patch);
      const file = result[0].files[0];
      const hunk = file.hunks[0];

      expect(consoleError).not.toHaveBeenCalled();
      expect(hunk.additionCount).toBe(4);
      expect(hunk.deletionCount).toBe(4);
      expect(hunk.hunkSpecs).toBe('@@ -1,4 +1,4 @@\n');
      expect(getTotalLineCountFromHunks(file.hunks)).toBe(4);
      expect(verifyPatchHunkValues(result).errors).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  test('repairs only the underfilled side of an asymmetric hunk', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = parsePatchFiles(
        [
          '--- asymmetric.txt\n',
          '+++ asymmetric.txt\n',
          '@@ -1,3 +1,2 @@\n',
          '-old\n',
          '+new\n',
          ' context\n',
        ].join('')
      );
      const hunk = result[0].files[0].hunks[0];

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0][0]).toContain('@@ -1,3 +1,2 @@');
      expect(consoleError.mock.calls[0][0]).toContain('declared old/new 3/2');
      expect(consoleError.mock.calls[0][0]).toContain('parsed old/new 2/2');
      expect(hunk.deletionCount).toBe(2);
      expect(hunk.additionCount).toBe(2);
      expect(verifyPatchHunkValues(result).errors).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  for (const {
    name,
    header,
    body,
    expectedAddition,
    expectedDeletion,
    expectedError,
  } of [
    {
      name: 'addition count changing from positive to zero',
      header: '@@ -5,1 +5,1 @@\n',
      body: '-gone\n',
      expectedAddition: { start: 4, count: 0 },
      expectedDeletion: { start: 5, count: 1 },
      expectedError: true,
    },
    {
      name: 'deletion count changing from positive to zero',
      header: '@@ -5,1 +5,1 @@\n',
      body: '+added\n',
      expectedAddition: { start: 5, count: 1 },
      expectedDeletion: { start: 4, count: 0 },
      expectedError: true,
    },
    {
      name: 'addition count changing from zero to positive',
      header: '@@ -5,1 +4,0 @@\n',
      body: '-old\n+new\n',
      expectedAddition: { start: 5, count: 1 },
      expectedDeletion: { start: 5, count: 1 },
      expectedError: true,
    },
    {
      name: 'deletion count changing from zero to positive',
      header: '@@ -4,0 +5,1 @@\n',
      body: '-old\n+new\n',
      expectedAddition: { start: 5, count: 1 },
      expectedDeletion: { start: 5, count: 1 },
      expectedError: true,
    },
    {
      name: 'both sides crossing zero in opposite directions',
      header: '@@ -5,1 +4,0 @@\n',
      body: '+added\n',
      expectedAddition: { start: 5, count: 1 },
      expectedDeletion: { start: 4, count: 0 },
      expectedError: true,
    },
    {
      name: 'both zero counts growing from hunk content',
      header: '@@ -4,0 +4,0 @@\n',
      body: '-old\n+new\n',
      expectedAddition: { start: 5, count: 1 },
      expectedDeletion: { start: 5, count: 1 },
      expectedError: true,
    },
    {
      name: 'a positive count growing from extra hunk content',
      header: '@@ -5,1 +5,1 @@\n',
      body: '-old\n+new\n-extra old\n',
      expectedAddition: { start: 5, count: 1 },
      expectedDeletion: { start: 5, count: 2 },
      expectedError: true,
    },
    {
      name: 'a valid zero-count side remaining unchanged',
      header: '@@ -4,0 +5,1 @@\n',
      body: '+added\n',
      expectedAddition: { start: 5, count: 1 },
      expectedDeletion: { start: 4, count: 0 },
      expectedError: false,
    },
  ]) {
    test(`preserves boundaries for ${name}`, () => {
      const consoleError = spyOn(console, 'error').mockImplementation(() => {});
      try {
        const result = parsePatchFiles(
          ['--- boundary.txt\n', '+++ boundary.txt\n', header, body].join('')
        );
        const hunk = result[0].files[0].hunks[0];

        expect(consoleError).toHaveBeenCalledTimes(expectedError ? 1 : 0);
        expect({
          start: hunk.additionStart,
          count: hunk.additionCount,
        }).toEqual(expectedAddition);
        expect({
          start: hunk.deletionStart,
          count: hunk.deletionCount,
        }).toEqual(expectedDeletion);
        expect(hunk.collapsedBefore).toBe(4);
        expect(verifyPatchHunkValues(result).errors).toEqual([]);
      } finally {
        consoleError.mockRestore();
      }
    });
  }

  test('shifts hydrated hunk and content indexes with a repaired start', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const file = processFile(
        [
          '--- hydrated.txt\n',
          '+++ hydrated.txt\n',
          '@@ -5,1 +4,0 @@\n',
          '+new\n',
          '-old\n',
        ].join(''),
        {
          oldFile: {
            name: 'hydrated.txt',
            contents: 'a\nb\nc\nd\nold\nz\n',
          },
          newFile: {
            name: 'hydrated.txt',
            contents: 'a\nb\nc\nd\nnew\nz\n',
          },
        }
      );
      assertDefined(file, 'file should be parsed');
      const hunk = file.hunks[0];
      const content = hunk.hunkContent[0];

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(hunk.additionLineIndex).toBe(4);
      expect(hunk.deletionLineIndex).toBe(4);
      expect(content.additionLineIndex).toBe(4);
      expect(content.deletionLineIndex).toBe(4);
    } finally {
      consoleError.mockRestore();
    }
  });

  test('chains later hunk geometry from a zero-to-positive repair', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = parsePatchFiles(
        [
          '--- multiple-zero.txt\n',
          '+++ multiple-zero.txt\n',
          '@@ -5,1 +4,0 @@\n',
          '+new\n',
          '-old\n',
          '@@ -8 +8 @@\n',
          '-later old\n',
          '+later new\n',
        ].join('')
      );
      const file = result[0].files[0];
      const [firstHunk, secondHunk] = file.hunks;

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(firstHunk.additionStart).toBe(5);
      expect(firstHunk.additionCount).toBe(1);
      expect(secondHunk.collapsedBefore).toBe(2);
      expect(verifyPatchHunkValues(result).errors).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  test('uses repaired counts for geometry after an underfilled hunk', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = parsePatchFiles(
        [
          '--- multiple.txt\n',
          '+++ multiple.txt\n',
          '@@ -1,4 +1,4 @@\n',
          '-old\n',
          '+new\n',
          ' context\n',
          '-tail\n',
          '+TAIL\n',
          '@@ -6 +6 @@\n',
          '-later old\n',
          '+later new\n',
        ].join('')
      );
      const file = result[0].files[0];
      const [firstHunk, secondHunk] = file.hunks;

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0][0]).toContain('@@ -1,4 +1,4 @@');
      expect(consoleError.mock.calls[0][0]).toContain('declared old/new 4/4');
      expect(consoleError.mock.calls[0][0]).toContain('parsed old/new 3/3');
      expect(firstHunk.additionCount).toBe(3);
      expect(firstHunk.deletionCount).toBe(3);
      expect(secondHunk.additionCount).toBe(1);
      expect(secondHunk.deletionCount).toBe(1);
      expect(secondHunk.collapsedBefore).toBe(2);
      expect(secondHunk.splitLineStart).toBe(5);
      expect(secondHunk.unifiedLineStart).toBe(7);
      expect(file.splitLineCount).toBe(6);
      expect(file.unifiedLineCount).toBe(9);
      expect(verifyPatchHunkValues(result).errors).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  test('throws in strict mode when a hunk has extra content lines', () => {
    expect(() =>
      parsePatchFiles(
        [
          '--- extra.txt\n',
          '+++ extra.txt\n',
          '@@ -1 +1 @@\n',
          '-old line\n',
          '+new line\n',
          '-extra old line\n',
        ].join(''),
        undefined,
        true
      )
    ).toThrow('hunk has more lines than expected');
  });

  test('throws in strict mode when a fake unified header creates a file without hunks', () => {
    expect(() =>
      parsePatchFiles(
        [
          '--- markers.txt\n',
          '+++ markers.txt\n',
          '@@ -1 +1 @@\n',
          '--- old marker\n',
          '+++ new marker\n',
          '--- fake-old-marker\n',
          '+++ fake-new-marker\n',
        ].join(''),
        undefined,
        true
      )
    ).toThrow('unified file has no hunks');
  });

  test('ignores format-patch version trailers after the final hunk', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = parsePatchFiles(formatPatchWithVersionTrailer);

      expect(consoleError).not.toHaveBeenCalled();
      expect(verifyPatchHunkValues(result).errors).toEqual([]);
      expect(result[0].files[0].hunks[0].additionLines).toBe(1);
      expect(result[0].files[0].hunks[0].deletionLines).toBe(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  test('ignores hunk-looking patch metadata before unified file headers', () => {
    const result = parsePatchFiles(
      [
        'Patch metadata mentions @@ -1 +1 @@ before the file header.\n',
        '@@ -1 +1 @@ is here.\n',
        '\n',
        '--- metadata.txt\n',
        '+++ metadata.txt\n',
        '@@ -1 +1 @@\n',
        '-old line\n',
        '+new line\n',
      ].join(''),
      undefined,
      true
    );

    expect(result[0]?.patchMetadata).toBe(
      'Patch metadata mentions @@ -1 +1 @@ before the file header.\n@@ -1 +1 @@ is here.\n\n'
    );
    expect(result[0]?.files).toHaveLength(1);
    expect(result[0]?.files[0]?.name).toBe('metadata.txt');
  });

  test('parses deleted SQL comment lines as hunk content in unified patches', () => {
    const result = parsePatchFiles(
      [
        '--- sql/test.sql\n',
        '+++ sql/test.sql\n',
        '@@ -1,5 +1,4 @@\n',
        ' -- This is a test sql file\n',
        '--- This is an sql comment\n',
        ' \n',
        ' CREATE TABLE users (\n',
        ' id BIGSERIAL PRIMARY KEY,\n',
      ].join(''),
      undefined,
      true
    );

    const file = result[0]?.files[0];
    expect(result[0]?.files).toHaveLength(1);
    expect(file?.name).toBe('sql/test.sql');
    expect(file?.deletionLines).toEqual([
      '-- This is a test sql file\n',
      '-- This is an sql comment\n',
      '\n',
      'CREATE TABLE users (\n',
      'id BIGSERIAL PRIMARY KEY,\n',
    ]);
    expect(file?.additionLines).toEqual([
      '-- This is a test sql file\n',
      '\n',
      'CREATE TABLE users (\n',
      'id BIGSERIAL PRIMARY KEY,\n',
    ]);
  });

  test('does not split hunk content that resembles unified file headers', () => {
    const result = parsePatchFiles(
      [
        '--- markers.txt\n',
        '+++ markers.txt\n',
        '@@ -1 +1 @@\n',
        '--- old marker\n',
        '+++ new marker\n',
      ].join(''),
      undefined,
      true
    );

    const file = result[0]?.files[0];
    expect(result[0]?.files).toHaveLength(1);
    expect(file?.name).toBe('markers.txt');
    expect(file?.deletionLines).toEqual(['-- old marker\n']);
    expect(file?.additionLines).toEqual(['++ new marker\n']);
  });

  test('preserves leading BOM characters in parsed hunk lines', () => {
    const result = parsePatchFiles(
      [
        'diff --git a/bom.txt b/bom.txt\n',
        'index 1111111..2222222 100644\n',
        '--- a/bom.txt\n',
        '+++ b/bom.txt\n',
        '@@ -1 +1 @@\n',
        '-\uFEFFold\n',
        '+\uFEFFnew\n',
      ].join('')
    );

    const file = result[0]?.files[0];
    expect(file?.deletionLines[0]).toBe('\uFEFFold\n');
    expect(file?.additionLines[0]).toBe('\uFEFFnew\n');
  });

  test('preserves lone surrogate characters in parsed hunk lines', () => {
    const result = parsePatchFiles(
      [
        'diff --git a/surrogate.txt b/surrogate.txt\n',
        'index 1111111..2222222 100644\n',
        '--- a/surrogate.txt\n',
        '+++ b/surrogate.txt\n',
        '@@ -1 +1 @@\n',
        '-old\ud800\n',
        '+new\ud800\n',
      ].join('')
    );

    const file = result[0]?.files[0];
    expect(file?.deletionLines[0]).toBe('old\ud800\n');
    expect(file?.additionLines[0]).toBe('new\ud800\n');
  });

  test('parses quoted git diff headers with escaped file names', () => {
    const oldName =
      'test/integration/image-optimizer/app/public/\\303\\244\\303\\266\\303\\274\\305\\241\\304\\215\\305\\231\\303\\255.png';
    const newName =
      'test/e2e/image-optimizer/app/public/\\303\\244\\303\\266\\303\\274\\305\\241\\304\\215\\305\\231\\303\\255.png';
    const file = processFile(
      [
        `diff --git "a/${oldName}" "b/${newName}"\n`,
        'similarity index 100%\n',
      ].join(''),
      { isGitDiff: true }
    );

    expect(file?.name).toBe(newName);
    expect(file?.prevName).toBe(oldName);
    expect(file?.type).toBe('rename-pure');
  });

  test(
    'splitLineCount should match rendered line count in split mode',
    async () => {
      for (const patch of result) {
        for (const file of patch.files) {
          if (file.hunks.length === 0) continue;

          const renderer = new DiffHunksRenderer({ diffStyle: 'split' });
          const renderResult = await renderer.asyncRender(file);
          // Split mode: both columns have the same visual height due to a
          // combination of lines and empty buffer regions.  Line types will be a
          // mix of context, additions and deletions.  Lets make sure what we
          // math from parsePatchFiles is correctly rendered and vice versa.
          const expectedSplitRows = file.hunks.reduce(
            (sum, hunk) => sum + hunk.splitLineCount,
            0
          );
          expect(expectedSplitRows).toBe(countSplitRows(renderResult));
        }
      }
    },
    { timeout: 15000 }
  );

  test(
    'unifiedLineCount should match rendered line count in unified mode',
    async () => {
      for (const patch of result) {
        for (const file of patch.files) {
          if (file.hunks.length === 0) continue;
          const renderer = new DiffHunksRenderer({ diffStyle: 'unified' });
          const { unifiedContentAST } = await renderer.asyncRender(file);
          assertDefined(
            unifiedContentAST,
            'unifiedContentAST should be defined'
          );
          // In 'unified' style we stack all output as context, deletions,
          // additions. Lets ensure we are mathing correctly and rendering to
          // this math
          const expectedUnifiedLines = file.hunks.reduce(
            (sum, hunk) => sum + hunk.unifiedLineCount,
            0
          );
          expect(expectedUnifiedLines).toBe(
            countRenderedLines(unifiedContentAST)
          );
        }
      }
    },
    { timeout: 15000 }
  );
});
