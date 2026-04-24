import { describe, expect, test } from 'bun:test';

import { loadFileTreeController } from './helpers/loadFileTree';

describe('file-tree controller focus and selection', () => {
  test('controller exposes path-first visible rows without leaking numeric ids', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['z.ts', 'a.ts'],
    });

    const [firstRow] = controller.getVisibleRows(0, 0);

    expect(firstRow?.path).toBe('a.ts');
    expect(Reflect.has(firstRow ?? {}, 'id')).toBe(false);

    controller.destroy();
  });

  test('controller getItem returns minimal file/directory handles with selection + focus state and null on miss', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 1,
      paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
    });

    const fileItem = controller.getItem('README.md');
    const directoryItem = controller.getItem('src');

    expect(fileItem?.getPath()).toBe('README.md');
    expect(fileItem?.isDirectory()).toBe(false);
    expect(fileItem?.isFocused()).toBe(false);
    expect(fileItem?.isSelected()).toBe(false);
    expect('expand' in (fileItem ?? {})).toBe(false);

    expect(directoryItem?.getPath()).toBe('src/');
    expect(directoryItem?.isDirectory()).toBe(true);
    if (
      directoryItem == null ||
      directoryItem.isDirectory() !== true ||
      !('isExpanded' in directoryItem)
    ) {
      throw new Error('expected directory item');
    }

    expect(directoryItem.isExpanded()).toBe(true);
    expect(directoryItem.isFocused()).toBe(true);
    expect(directoryItem.isSelected()).toBe(false);
    fileItem?.focus();
    expect(fileItem?.isFocused()).toBe(true);
    expect(directoryItem.isFocused()).toBe(false);
    expect(controller.getFocusedPath()).toBe('README.md');

    fileItem?.select();
    expect(fileItem?.isSelected()).toBe(true);
    directoryItem.select();
    expect(controller.getSelectedPaths()).toEqual(['README.md', 'src/']);
    directoryItem.toggleSelect();
    expect(controller.getSelectedPaths()).toEqual(['README.md']);
    fileItem?.deselect();
    expect(controller.getSelectedPaths()).toEqual([]);
    expect(controller.getItem('missing.ts')).toBeNull();

    controller.destroy();
  });

  test('controller initialSelectedPaths drops missing entries, canonicalizes directories, and focuses the last resolved path', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      initialSelectedPaths: ['missing.ts', 'src/foo'],
      paths: ['README.md', 'src/foo/bar.ts'],
    });

    expect(controller.getSelectedPaths()).toEqual(['src/foo/']);
    expect(controller.getFocusedPath()).toBe('src/foo/');
    expect(controller.getFocusedItem()?.getPath()).toBe('src/foo/');
    expect(controller.getItem('src/foo')?.isSelected()).toBe(true);
    expect(controller.getItem('src/foo')?.isFocused()).toBe(true);

    controller.destroy();

    const invalidOnlyController = new FileTreeController({
      flattenEmptyDirectories: false,
      initialSelectedPaths: ['missing.ts'],
      paths: ['a.ts', 'b.ts'],
    });

    expect(invalidOnlyController.getSelectedPaths()).toEqual([]);
    expect(invalidOnlyController.getFocusedPath()).toBe('a.ts');

    invalidOnlyController.destroy();
  });

  test('controller initialSelectedPaths uses the last resolved path as the focus target and range anchor', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      initialSelectedPaths: ['a.ts', 'c.ts'],
      paths: ['a.ts', 'b.ts', 'c.ts'],
    });

    expect(controller.getSelectedPaths()).toEqual(['a.ts', 'c.ts']);
    expect(controller.getFocusedPath()).toBe('c.ts');

    controller.selectPathRange('b.ts', false);
    expect(controller.getSelectedPaths()).toEqual(['b.ts', 'c.ts']);

    controller.destroy();
  });

  test('controller focus helpers keep exactly one focused visible item', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
    });

    const getFocusedPaths = () =>
      controller
        .getVisibleRows(0, controller.getVisibleCount() - 1)
        .filter((row) => row.isFocused)
        .map((row) => row.path);

    expect(getFocusedPaths()).toEqual(['src/']);

    controller.focusNextItem();
    expect(controller.getFocusedPath()).toBe('src/lib/');
    expect(getFocusedPaths()).toEqual(['src/lib/']);

    controller.focusLastItem();
    expect(controller.getFocusedPath()).toBe('README.md');
    expect(getFocusedPaths()).toEqual(['README.md']);

    controller.focusPreviousItem();
    expect(controller.getFocusedPath()).toBe('src/index.ts');

    controller.focusPath('src/lib/util.ts');
    expect(controller.getFocusedPath()).toBe('src/lib/util.ts');

    controller.focusParentItem();
    expect(controller.getFocusedPath()).toBe('src/lib/');

    controller.focusFirstItem();
    expect(controller.getFocusedPath()).toBe('src/');
    expect(getFocusedPaths()).toEqual(['src/']);

    controller.destroy();
  });

  test('controller focus parent works after toggling with focus beyond the initial projection', async () => {
    const FileTreeController = await loadFileTreeController();
    const paths = Array.from(
      { length: 700 },
      (_, index) => `dir-${String(index).padStart(3, '0')}/child.txt`
    );
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths,
    });

    controller.focusPath('dir-650/child.txt');
    expect(controller.getFocusedPath()).toBe('dir-650/child.txt');
    expect(controller.getFocusedIndex()).toBeGreaterThan(512);

    const firstDirectory = controller.getItem('dir-000/');
    if (
      firstDirectory == null ||
      !firstDirectory.isDirectory() ||
      !('collapse' in firstDirectory)
    ) {
      throw new Error('missing first directory');
    }
    firstDirectory.collapse();

    expect(controller.getFocusedPath()).toBe('dir-650/child.txt');
    expect(controller.getFocusedIndex()).toBeGreaterThan(512);

    controller.focusParentItem();
    expect(controller.getFocusedPath()).toBe('dir-650/');
    expect(controller.getFocusedIndex()).toBeGreaterThan(512);

    controller.destroy();
  });

  test('resetPaths prunes stale selections and resets a hidden range anchor', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['a.ts', 'b.ts', 'c.ts'],
    });

    controller.selectOnlyPath('a.ts');
    controller.selectPathRange('c.ts', false);
    expect(controller.getSelectedPaths()).toEqual(['a.ts', 'b.ts', 'c.ts']);

    controller.resetPaths(['b.ts', 'd.ts']);
    expect(controller.getSelectedPaths()).toEqual(['b.ts']);

    controller.selectPathRange('d.ts', false);
    expect(controller.getSelectedPaths()).toEqual(['d.ts']);

    controller.destroy();
  });

  test('resetPaths canonicalizes selected paths when a file becomes a directory', async () => {
    const FileTreeController = await loadFileTreeController();

    // Start with "src/foo" as a plain file.
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/foo'],
    });

    controller.selectOnlyPath('src/foo');
    expect(controller.getSelectedPaths()).toEqual(['src/foo']);

    // After a refresh "src/foo" is now a directory ("src/foo/") with a child.
    // The old selected path "src/foo" resolves to the new canonical "src/foo/"
    // via the trailing-slash fallback — resetPaths must store the resolved
    // canonical form so that visible-row selection checks match.
    controller.resetPaths(['src/foo/bar.ts']);
    expect(controller.getSelectedPaths()).toEqual(['src/foo/']);
    expect(controller.getItem('src/foo/')?.isSelected()).toBe(true);

    controller.destroy();
  });

  test('deep initialExpandedPaths expands ancestor directories in handle state and visible rows', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/lib'],
      paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
    });

    const srcItem = controller.getItem('src');
    const libItem = controller.getItem('src/lib');

    if (
      srcItem == null ||
      srcItem.isDirectory() !== true ||
      !('isExpanded' in srcItem)
    ) {
      throw new Error('expected src directory item');
    }
    if (
      libItem == null ||
      libItem.isDirectory() !== true ||
      !('isExpanded' in libItem)
    ) {
      throw new Error('expected src/lib directory item');
    }

    expect(srcItem.isExpanded()).toBe(true);
    expect(libItem.isExpanded()).toBe(true);
    expect(controller.getVisibleRows(0, 10).map((row) => row.path)).toEqual([
      'src/',
      'src/lib/',
      'src/lib/util.ts',
      'src/index.ts',
      'README.md',
    ]);

    controller.destroy();
  });

  test('collapsing a parent directory preserves descendant expansion when the parent reopens', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/components/deep'],
      paths: [
        'README.md',
        'src/index.ts',
        'src/components/Other.tsx',
        'src/components/deep/Button.tsx',
        'src/components/deep/Card.tsx',
      ],
    });

    const componentsItem = controller.getItem('src/components');
    const deepItem = controller.getItem('src/components/deep');

    if (
      componentsItem == null ||
      componentsItem.isDirectory() !== true ||
      !('collapse' in componentsItem) ||
      !('expand' in componentsItem)
    ) {
      throw new Error('expected src/components directory item');
    }
    if (
      deepItem == null ||
      deepItem.isDirectory() !== true ||
      !('isExpanded' in deepItem)
    ) {
      throw new Error('expected src/components/deep directory item');
    }

    expect(deepItem.isExpanded()).toBe(true);
    expect(controller.getVisibleRows(0, 20).map((row) => row.path)).toContain(
      'src/components/deep/Button.tsx'
    );

    componentsItem.collapse();
    expect(deepItem.isExpanded()).toBe(true);
    expect(
      controller.getVisibleRows(0, 20).map((row) => row.path)
    ).not.toContain('src/components/deep/');

    componentsItem.expand();
    expect(deepItem.isExpanded()).toBe(true);
    expect(controller.getVisibleRows(0, 20).map((row) => row.path)).toContain(
      'src/components/deep/Button.tsx'
    );

    controller.destroy();
  });

  test('resetPaths preserves focus on surviving paths and resets focus when focused path is removed', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['a.ts', 'b.ts', 'c.ts'],
    });

    controller.focusPath('b.ts');
    expect(controller.getFocusedPath()).toBe('b.ts');

    // Replace paths keeping b.ts — focus should survive
    controller.resetPaths(['a.ts', 'b.ts', 'd.ts']);
    expect(controller.getFocusedPath()).toBe('b.ts');

    // Replace paths removing b.ts — focus should fall back
    controller.resetPaths(['a.ts', 'd.ts']);
    expect(controller.getFocusedPath()).not.toBe('b.ts');
    expect(controller.getFocusedPath()).not.toBeNull();

    // Replace with empty — focus should be null
    controller.resetPaths([]);
    expect(controller.getFocusedPath()).toBeNull();

    controller.destroy();
  });

  test('controller subscribe fires when resetPaths prunes selected items', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['a.ts', 'b.ts', 'c.ts'],
    });

    controller.selectOnlyPath('a.ts');
    controller.selectPathRange('c.ts', false);
    expect(controller.getSelectedPaths()).toEqual(['a.ts', 'b.ts', 'c.ts']);
    const versionBeforeReplace = controller.getSelectionVersion();

    // Remove b.ts — selection should prune it
    controller.resetPaths(['a.ts', 'c.ts']);
    expect(controller.getSelectedPaths()).toEqual(['a.ts', 'c.ts']);
    expect(controller.getSelectionVersion()).toBeGreaterThan(
      versionBeforeReplace
    );

    // Replace with all new paths — selection fully pruned
    const versionBeforeFullPrune = controller.getSelectionVersion();
    controller.resetPaths(['x.ts', 'y.ts']);
    expect(controller.getSelectedPaths()).toEqual([]);
    expect(controller.getSelectionVersion()).toBeGreaterThan(
      versionBeforeFullPrune
    );

    // Replace that doesn't affect selection — version stays the same
    controller.selectOnlyPath('x.ts');
    const versionBeforeNoOp = controller.getSelectionVersion();
    controller.resetPaths(['x.ts', 'z.ts']);
    expect(controller.getSelectedPaths()).toEqual(['x.ts']);
    expect(controller.getSelectionVersion()).toBe(versionBeforeNoOp);

    controller.destroy();
  });
});
