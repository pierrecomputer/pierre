import { describe, expect, spyOn, test } from 'bun:test';

import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';
import { diffPatch, finalBlankLinePatch, malformedPatch } from './mocks';
import {
  assertDefined,
  countRenderedLines,
  countSplitRows,
  verifyPatchHunkValues,
} from './testUtils';

describe('parsePatchFiles', () => {
  const result = parsePatchFiles(diffPatch);
  test('should parse diff.patch and match snapshot', () => {
    expect(result).toMatchSnapshot('git pr patch file');
  });

  test('patches with a final blank line should have a \\n added', () => {
    const result = parsePatchFiles(finalBlankLinePatch);
    expect(result).toMatchSnapshot('final blank line patch');
  });

  test('should have accurate hunk line values', () => {
    const { valid, errors } = verifyPatchHunkValues(result);
    if (!valid) {
      console.error('Hunk line value errors:', errors);
    }
    expect(valid).toBe(true);
  });

  test('should warn on malformed patch with bare newline in hunk', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(
      (...args: unknown[]) => {
        console.log('  * test expected console.error:', args);
      }
    );
    const result = parsePatchFiles(malformedPatch);

    // Should have logged an error for the invalid line, but should still try
    // to do its best to parse things out
    expect(consoleError).toHaveBeenCalled();
    expect(consoleError.mock.calls[0][0]).toContain('Invalid firstChar');

    // The hunk counts should be off by 1 due to the missing line
    const hunk = result[0].files[0].hunks[0];
    expect(hunk.deletionCount).toBe(87);
    expect(hunk.deletionLines).toBe(86);
    expect(result).toMatchSnapshot('malformed patch');
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
          const { unifiedAST } = await renderer.asyncRender(file);
          assertDefined(unifiedAST, 'unifiedAST should be defined');
          // In 'unified' style we stack all output as context, deletions,
          // additions. Lets ensure we are mathing correctly and rendering to
          // this math
          const expectedUnifiedLines = file.hunks.reduce(
            (sum, hunk) => sum + hunk.unifiedLineCount,
            0
          );
          expect(expectedUnifiedLines).toBe(countRenderedLines(unifiedAST));
        }
      }
    },
    { timeout: 15000 }
  );
});
