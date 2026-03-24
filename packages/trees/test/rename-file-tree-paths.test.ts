import { describe, expect, test } from 'bun:test';

import { renameFileTreePaths } from '../src/utils/renameFileTreePaths';

describe('renameFileTreePaths', () => {
  test('rejects file rename when destination path is an existing folder prefix', () => {
    const result = renameFileTreePaths({
      files: ['README.md', 'src/index.ts', 'src/utils/helpers.ts'],
      path: 'README.md',
      isFolder: false,
      nextBasename: 'src',
    });

    expect(result).toEqual({
      error: '"src" already exists.',
    });
  });
});
