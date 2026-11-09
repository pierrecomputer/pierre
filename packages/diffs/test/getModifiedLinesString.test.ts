import { describe, expect, test } from 'bun:test';

import { getModifiedLinesString } from '../src/utils/getModifiedLinesString';

describe('getModifiedLinesString', () => {
  test('a fold of unchanged lines reads "N unmodified lines"', () => {
    expect(getModifiedLinesString(0)).toBe('0 unmodified lines');
    expect(getModifiedLinesString(1)).toBe('1 unmodified line');
    expect(getModifiedLinesString(40)).toBe('40 unmodified lines');
  });

  test('a fold that also hides changes reads "N lines, includes changes"', () => {
    expect(getModifiedLinesString(1, true)).toBe('1 line, includes changes');
    expect(getModifiedLinesString(40, true)).toBe('40 lines, includes changes');
  });
});
