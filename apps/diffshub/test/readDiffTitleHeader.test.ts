import { describe, expect, test } from 'bun:test';

import { readDiffTitleHeader } from '../lib/readDiffTitleHeader';

describe('readDiffTitleHeader', () => {
  test('builds a tab title from the encoded header', () => {
    const headers = new Headers({
      'X-Diffshub-Title': encodeURIComponent('Fix café rendering'),
    });
    expect(readDiffTitleHeader(headers)).toBe('Fix café rendering — DiffsHub');
  });

  test('returns undefined when the header is missing, blank, or malformed', () => {
    expect(readDiffTitleHeader(new Headers())).toBeUndefined();
    expect(
      readDiffTitleHeader(new Headers({ 'X-Diffshub-Title': '%20' }))
    ).toBeUndefined();
    expect(
      readDiffTitleHeader(new Headers({ 'X-Diffshub-Title': '%E0%A4%A' }))
    ).toBeUndefined();
  });
});
