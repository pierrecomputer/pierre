import { describe, expect, spyOn, test } from 'bun:test';

import { parsePatchFiles } from '../src/utils/parsePatchFiles';
import { diffPatch, malformedPatch } from './mocks';
import { verifyPatchHunkValues } from './testUtils';

describe('parsePatchFiles', () => {
  const result = parsePatchFiles(diffPatch);
  test('should parse diff.patch and match snapshot', () => {
    expect(result).toMatchSnapshot('git pr patch file');
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
});
