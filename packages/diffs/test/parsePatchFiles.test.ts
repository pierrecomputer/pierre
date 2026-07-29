import { afterAll, describe, expect, spyOn, test } from 'bun:test';

import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { lineAt, linesToArray } from '../src/utils/diffLines';
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
  withPlainLines,
} from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

describe('parsePatchFiles', () => {
  const result = parsePatchFiles(diffPatch);
  test('should parse diff.patch and match its digest snapshot', () => {
    // Per-file hunk geometry of the whole 400KB patch; line-level accuracy
    // is covered by the invariant and render-count tests below
    expect(patchDigest(result)).toMatchSnapshot('git pr patch digest');
  });

  test('patches with a final blank line should have a \\n added', () => {
    const result = parsePatchFiles(finalBlankLinePatch);
    expect(withPlainLines(result)).toMatchSnapshot('final blank line patch');
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

      // The hunk counts should be off by 1 due to the missing line
      const hunk = result[0].files[0].hunks[0];
      expect(hunk.deletionCount).toBe(87);
      expect(hunk.deletionLines).toBe(86);
      expect(withPlainLines(result)).toMatchSnapshot('malformed patch');
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
    assertDefined(file, 'expected a parsed file');
    expect(result[0]?.files).toHaveLength(1);
    expect(file.name).toBe('sql/test.sql');
    expect(linesToArray(file.deletionLines)).toEqual([
      '-- This is a test sql file\n',
      '-- This is an sql comment\n',
      '\n',
      'CREATE TABLE users (\n',
      'id BIGSERIAL PRIMARY KEY,\n',
    ]);
    expect(linesToArray(file.additionLines)).toEqual([
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
    assertDefined(file, 'expected a parsed file');
    expect(result[0]?.files).toHaveLength(1);
    expect(file.name).toBe('markers.txt');
    expect(linesToArray(file.deletionLines)).toEqual(['-- old marker\n']);
    expect(linesToArray(file.additionLines)).toEqual(['++ new marker\n']);
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
    assertDefined(file, 'expected a parsed file');
    expect(lineAt(file.deletionLines, 0)).toBe('\uFEFFold\n');
    expect(lineAt(file.additionLines, 0)).toBe('\uFEFFnew\n');
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
    assertDefined(file, 'expected a parsed file');
    expect(lineAt(file.deletionLines, 0)).toBe('old\ud800\n');
    expect(lineAt(file.additionLines, 0)).toBe('new\ud800\n');
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
