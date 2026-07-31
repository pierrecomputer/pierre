import { describe, expect, test } from 'bun:test';

import { FileTree } from '../src/render/FileTree';

describe('FileTree public navigation', () => {
  test('traverses rows in the current visible tree order', () => {
    const fileTree = new FileTree({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
    });

    expect(fileTree.getVisibleCount()).toBe(5);
    expect(
      fileTree
        .getVisibleRows(0, fileTree.getVisibleCount() - 1)
        .map((row) => [row.path, row.kind])
    ).toEqual([
      ['src/', 'directory'],
      ['src/lib/', 'directory'],
      ['src/lib/util.ts', 'file'],
      ['src/index.ts', 'file'],
      ['README.md', 'file'],
    ]);

    expect(fileTree.getFocusedIndex()).toBe(0);
    fileTree.focusNextItem();
    expect(fileTree.getFocusedPath()).toBe('src/lib/');
    expect(fileTree.getFocusedIndex()).toBe(1);

    fileTree.focusLastItem();
    expect(fileTree.getFocusedPath()).toBe('README.md');
    fileTree.focusPreviousItem();
    expect(fileTree.getFocusedPath()).toBe('src/index.ts');

    fileTree.focusParentItem();
    expect(fileTree.getFocusedPath()).toBe('src/');
    fileTree.focusFirstItem();
    expect(fileTree.getFocusedPath()).toBe('src/');

    fileTree.cleanUp();
  });

  test('visible rows reflect directory expansion changes', () => {
    const fileTree = new FileTree({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
    });
    const src = fileTree.getItem('src');
    if (src == null || !('collapse' in src)) {
      throw new Error('expected src directory');
    }

    src.collapse();

    expect(fileTree.getVisibleCount()).toBe(2);
    expect(fileTree.getVisibleRows(0, 1).map((row) => row.path)).toEqual([
      'src/',
      'README.md',
    ]);
    fileTree.focusLastItem();
    fileTree.focusNextItem();
    expect(fileTree.getFocusedPath()).toBe('README.md');

    fileTree.cleanUp();
  });
});
