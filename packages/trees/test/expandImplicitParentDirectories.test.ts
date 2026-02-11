import { describe, expect, test } from 'bun:test';

import { expandImplicitParentDirectories } from '../src/utils/expandImplicitParentDirectories';

describe('expandImplicitParentDirectories', () => {
  test('expands a deep path into explicit ancestors', () => {
    expect(expandImplicitParentDirectories(['a/b/c'])).toEqual([
      'a',
      'a/b',
      'a/b/c',
    ]);
  });

  test('dedupes and stabilizes order across multiple inputs', () => {
    expect(expandImplicitParentDirectories(['a/b/c', 'a/b/d', 'x'])).toEqual([
      'a',
      'x',
      'a/b',
      'a/b/c',
      'a/b/d',
    ]);
  });

  test('strips flattened prefix if passed accidentally', () => {
    expect(expandImplicitParentDirectories(['f::a/b/c'])).toEqual([
      'a',
      'a/b',
      'a/b/c',
    ]);
  });
});
