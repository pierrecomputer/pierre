import { describe, expect, test } from 'bun:test';

import { fileListToTree } from '../src/utils/fileListToTree';

describe('fileListToTree', () => {
  test('should convert a simple file list to tree structure', () => {
    const files = ['src/index.ts', 'src/utils/helper.ts'];
    const tree = fileListToTree(files);

    // No flattened since direct and flattened would be identical
    expect(tree).toEqual({
      root: {
        name: 'root',
        children: {
          direct: ['src'],
        },
      },
      src: {
        name: 'src',
        children: {
          direct: ['src/index.ts', 'src/utils'],
        },
      },
      'src/index.ts': { name: 'index.ts' },
      'src/utils': {
        name: 'utils',
        children: {
          direct: ['src/utils/helper.ts'],
        },
      },
      'src/utils/helper.ts': { name: 'helper.ts' },
    });
  });

  test('should handle files at root level', () => {
    const files = ['README.md', 'package.json'];
    const tree = fileListToTree(files);

    // No flattened since direct and flattened would be identical
    expect(tree).toEqual({
      root: {
        name: 'root',
        children: {
          direct: ['README.md', 'package.json'],
        },
      },
      'README.md': { name: 'README.md' },
      'package.json': { name: 'package.json' },
    });
  });

  test('should handle deeply nested files', () => {
    const files = ['a/b/c/d/file.ts'];
    const tree = fileListToTree(files);

    // Root has flattened since it differs from direct (flattened path vs direct folder)
    expect(tree.root).toEqual({
      name: 'root',
      children: {
        direct: ['a'],
        flattened: ['f::a/b/c/d'],
      },
    });

    // Intermediate folders don't have flattened (they're part of the chain)
    expect(tree.a).toEqual({
      name: 'a',
      children: {
        direct: ['a/b'],
      },
    });
    expect(tree['a/b']).toEqual({
      name: 'b',
      children: {
        direct: ['a/b/c'],
      },
    });
    expect(tree['a/b/c']).toEqual({
      name: 'c',
      children: {
        direct: ['a/b/c/d'],
      },
    });

    // The endpoint folder - no flattened since it would be identical to direct
    expect(tree['a/b/c/d']).toEqual({
      name: 'd',
      children: {
        direct: ['a/b/c/d/file.ts'],
      },
    });
    expect(tree['a/b/c/d/file.ts']).toEqual({ name: 'file.ts' });

    // Flattened node - no flattened since children would be identical to direct
    expect(tree['f::a/b/c/d']).toEqual({
      name: 'a/b/c/d',
      flattens: ['a', 'a/b', 'a/b/c', 'a/b/c/d'],
      children: {
        direct: ['a/b/c/d/file.ts'],
      },
    });
  });

  test('should handle multiple files in the same folder', () => {
    const files = [
      'src/components/Button.tsx',
      'src/components/Card.tsx',
      'src/components/Header.tsx',
    ];
    const tree = fileListToTree(files);

    // Root has flattened since it differs from direct
    expect(tree.root).toEqual({
      name: 'root',
      children: {
        direct: ['src'],
        flattened: ['f::src/components'],
      },
    });

    // src is an intermediate folder (only has one folder child)
    expect(tree.src).toEqual({
      name: 'src',
      children: {
        direct: ['src/components'],
      },
    });

    // src/components is the endpoint, has multiple children - no flattened since identical
    expect(tree['src/components'].children?.direct).toHaveLength(3);
    expect(tree['src/components'].children?.flattened).toBeUndefined();

    // Flattened node - no flattened since children would be identical to direct
    expect(tree['f::src/components']).toEqual({
      name: 'src/components',
      flattens: ['src', 'src/components'],
      children: {
        direct: expect.arrayContaining([
          'src/components/Button.tsx',
          'src/components/Card.tsx',
          'src/components/Header.tsx',
        ]),
      },
    });
  });

  test('should handle duplicate file paths', () => {
    const files = ['src/index.ts', 'src/index.ts', 'src/utils.ts'];
    const tree = fileListToTree(files);

    expect(tree.root.children?.direct).toEqual(['src']);
    expect(tree.src.children?.direct).toHaveLength(2);
    expect(tree.src.children?.direct).toContain('src/index.ts');
    expect(tree.src.children?.direct).toContain('src/utils.ts');
  });

  test('should support custom root id and name', () => {
    const files = ['file.ts'];
    const tree = fileListToTree(files, {
      root: {
        id: 'my-root',
        name: 'Project',
      },
    });

    // No flattened since identical to direct
    expect(tree['my-root']).toEqual({
      name: 'Project',
      children: {
        direct: ['file.ts'],
      },
    });
    expect(tree.root).toBeUndefined();
  });

  test('should handle empty file list', () => {
    const files: string[] = [];
    const tree = fileListToTree(files);

    expect(tree).toEqual({
      root: {
        name: 'root',
        children: {
          direct: [],
        },
      },
    });
  });

  test('should handle mixed depth files', () => {
    const files = [
      'README.md',
      'src/index.ts',
      'src/utils/deep/nested/file.ts',
    ];
    const tree = fileListToTree(files);

    expect(tree.root.children?.direct).toContain('README.md');
    expect(tree.root.children?.direct).toContain('src');
    // Root has no flattened since it has multiple direct children that aren't all flattenable
    expect(tree.root.children?.flattened).toBeUndefined();

    expect(tree['README.md']).toEqual({ name: 'README.md' });
    expect(tree['src/utils/deep/nested/file.ts']).toEqual({ name: 'file.ts' });

    // src has multiple children (index.ts and utils), so it's not flattenable itself
    // but utils -> deep -> nested is flattenable, so flattened differs from direct
    expect(tree.src.children?.direct).toContain('src/index.ts');
    expect(tree.src.children?.direct).toContain('src/utils');
    expect(tree.src.children?.flattened).toContain('src/index.ts');
    expect(tree.src.children?.flattened).toContain('f::src/utils/deep/nested');

    // The flattened node - no flattened since children would be identical to direct
    expect(tree['f::src/utils/deep/nested']).toEqual({
      name: 'utils/deep/nested',
      flattens: ['src/utils', 'src/utils/deep', 'src/utils/deep/nested'],
      children: {
        direct: ['src/utils/deep/nested/file.ts'],
      },
    });
  });

  test('should match snapshot for sample file list', () => {
    const sampleFileList = [
      'src/index.ts',
      'src/components/Button.tsx',
      'src/components/Card.tsx',
      'src/components/Header.tsx',
      'src/components/Sidebar.tsx',
      'src/lib/mdx.tsx',
      'src/lib/utils.ts',
      'src/utils/stream.ts',
      'src/utils/worker.ts',
      'build/index.mjs',
      'build/scripts.js',
      'config/app.config.json',
      'README.md',
      'package.json',
    ];

    const tree = fileListToTree(sampleFileList);
    expect(tree).toMatchSnapshot('sample file list tree');
  });

  test('should correctly flatten single-child folder chains', () => {
    // Test case: outer/middle/inner/file.ts where outer->middle->inner is a chain
    const files = ['outer/middle/inner/file.ts'];
    const tree = fileListToTree(files);

    // Root should have flattened pointing to the fully flattened path
    expect(tree.root.children?.flattened).toEqual(['f::outer/middle/inner']);

    // The flattened node - no flattened since children would be identical to direct
    expect(tree['f::outer/middle/inner']).toEqual({
      name: 'outer/middle/inner',
      flattens: ['outer', 'outer/middle', 'outer/middle/inner'],
      children: {
        direct: ['outer/middle/inner/file.ts'],
      },
    });
  });

  test('should not flatten folders with multiple children', () => {
    const files = ['folder/file1.ts', 'folder/file2.ts'];
    const tree = fileListToTree(files);

    // folder has 2 children (files), so it shouldn't be flattened
    // No flattened since direct and flattened would be identical
    expect(tree.root.children?.flattened).toBeUndefined();
    expect(tree['f::folder']).toBeUndefined();
  });

  test('should not flatten folders when child is a file', () => {
    const files = ['single/file.ts'];
    const tree = fileListToTree(files);

    // single has one child that is a file, not a folder, so not flattenable
    // No flattened since direct and flattened would be identical
    expect(tree.root.children?.flattened).toBeUndefined();
    expect(tree['f::single']).toBeUndefined();
  });

  test('should only include flattened when it differs from direct', () => {
    // This test verifies that flattened is only present when it contains
    // different entries than direct (i.e., has f:: prefixed paths)
    const files = [
      'src/simple/file.ts', // src/simple is not flattenable (file child)
      'src/deep/nested/inner/file.ts', // src/deep/nested/inner is flattenable
    ];
    const tree = fileListToTree(files);

    // src has two children: simple (not flattenable) and deep (flattenable)
    // So flattened differs from direct
    expect(tree.src.children?.direct).toEqual(['src/simple', 'src/deep']);
    expect(tree.src.children?.flattened).toEqual([
      'src/simple',
      'f::src/deep/nested/inner',
    ]);

    // src/simple has no flattened (would be identical to direct)
    expect(tree['src/simple'].children?.direct).toEqual(['src/simple/file.ts']);
    expect(tree['src/simple'].children?.flattened).toBeUndefined();

    // Verify the flattened node exists and has no flattened (identical to direct)
    expect(tree['f::src/deep/nested/inner']).toEqual({
      name: 'deep/nested/inner',
      flattens: ['src/deep', 'src/deep/nested', 'src/deep/nested/inner'],
      children: {
        direct: ['src/deep/nested/inner/file.ts'],
      },
    });
  });

  test('flattened node should have flattened when its children differ', () => {
    // A flattened node that itself contains flattenable children
    const files = [
      'a/b/file.ts', // a/b is the endpoint of a->b chain
      'a/b/c/d/file2.ts', // c/d is flattenable within a/b
    ];
    const tree = fileListToTree(files);

    // Root flattens a/b
    expect(tree.root.children?.flattened).toEqual(['f::a/b']);

    // The flattened node a/b has children that differ (c is flattenable)
    expect(tree['f::a/b']).toEqual({
      name: 'a/b',
      flattens: ['a', 'a/b'],
      children: {
        direct: ['a/b/file.ts', 'a/b/c'],
        flattened: ['a/b/file.ts', 'f::a/b/c/d'],
      },
    });

    // Nested flattened node
    expect(tree['f::a/b/c/d']).toEqual({
      name: 'c/d',
      flattens: ['a/b/c', 'a/b/c/d'],
      children: {
        direct: ['a/b/c/d/file2.ts'],
      },
    });
  });

  test('should handle multiple parallel flattenable chains', () => {
    // Two sibling folders that are both independently flattenable
    const files = [
      'src/feature-a/components/deep/Button.tsx',
      'src/feature-b/utils/helpers/format.ts',
    ];
    const tree = fileListToTree(files);

    // src has two flattenable children
    expect(tree.src.children?.direct).toEqual([
      'src/feature-a',
      'src/feature-b',
    ]);
    expect(tree.src.children?.flattened).toEqual([
      'f::src/feature-a/components/deep',
      'f::src/feature-b/utils/helpers',
    ]);

    // Both flattened nodes should exist
    expect(tree['f::src/feature-a/components/deep']).toEqual({
      name: 'feature-a/components/deep',
      flattens: [
        'src/feature-a',
        'src/feature-a/components',
        'src/feature-a/components/deep',
      ],
      children: {
        direct: ['src/feature-a/components/deep/Button.tsx'],
      },
    });

    expect(tree['f::src/feature-b/utils/helpers']).toEqual({
      name: 'feature-b/utils/helpers',
      flattens: [
        'src/feature-b',
        'src/feature-b/utils',
        'src/feature-b/utils/helpers',
      ],
      children: {
        direct: ['src/feature-b/utils/helpers/format.ts'],
      },
    });
  });

  test('should handle dotfiles and hidden folders', () => {
    const files = [
      '.gitignore',
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      '.vscode/settings.json',
    ];
    const tree = fileListToTree(files);

    // Root has dotfiles and dot-folders
    expect(tree.root.children?.direct).toContain('.gitignore');
    expect(tree.root.children?.direct).toContain('.github');
    expect(tree.root.children?.direct).toContain('.vscode');

    // .github/workflows is flattenable (single folder child)
    expect(tree.root.children?.flattened).toContain('f::.github/workflows');

    expect(tree['.gitignore']).toEqual({ name: '.gitignore' });

    expect(tree['f::.github/workflows']).toEqual({
      name: '.github/workflows',
      flattens: ['.github', '.github/workflows'],
      children: {
        direct: ['.github/workflows/ci.yml', '.github/workflows/deploy.yml'],
      },
    });
  });

  test('should handle file and folder with similar names', () => {
    // utils.ts (file) and utils/ (folder) at the same level
    const files = [
      'src/utils.ts',
      'src/utils/helper.ts',
      'src/utils/format.ts',
    ];
    const tree = fileListToTree(files);

    // src has both utils.ts and utils folder
    expect(tree.src.children?.direct).toContain('src/utils.ts');
    expect(tree.src.children?.direct).toContain('src/utils');

    // No flattened since utils folder has multiple children (not flattenable)
    expect(tree.src.children?.flattened).toBeUndefined();

    // Both should exist as separate entries
    expect(tree['src/utils.ts']).toEqual({ name: 'utils.ts' });
    expect(tree['src/utils']).toEqual({
      name: 'utils',
      children: {
        direct: ['src/utils/helper.ts', 'src/utils/format.ts'],
      },
    });
  });

  test('should produce consistent results regardless of input order', () => {
    const files1 = [
      'src/a/b/c/file1.ts',
      'src/a/b/c/file2.ts',
      'src/x/y/z/file3.ts',
    ];
    const files2 = [
      'src/x/y/z/file3.ts',
      'src/a/b/c/file2.ts',
      'src/a/b/c/file1.ts',
    ];

    const tree1 = fileListToTree(files1);
    const tree2 = fileListToTree(files2);

    // Both trees should have the same structure (keys)
    expect(Object.keys(tree1).sort()).toEqual(Object.keys(tree2).sort());

    // Both should have the same flattened nodes
    expect(tree1['f::src/a/b/c']).toBeDefined();
    expect(tree2['f::src/a/b/c']).toBeDefined();
    expect(tree1['f::src/x/y/z']).toBeDefined();
    expect(tree2['f::src/x/y/z']).toBeDefined();

    // The flattened nodes should have the same flattens arrays
    expect(tree1['f::src/a/b/c'].flattens).toEqual(
      tree2['f::src/a/b/c'].flattens
    );
  });

  test('should handle minimal two-folder flatten', () => {
    // Simplest flattenable case: just two folders
    const files = ['a/b/file.ts'];
    const tree = fileListToTree(files);

    expect(tree.root.children?.flattened).toEqual(['f::a/b']);

    expect(tree['f::a/b']).toEqual({
      name: 'a/b',
      flattens: ['a', 'a/b'],
      children: {
        direct: ['a/b/file.ts'],
      },
    });

    // Intermediate folder exists but has no flattened
    expect(tree.a).toEqual({
      name: 'a',
      children: {
        direct: ['a/b'],
      },
    });
  });

  test('should handle folder becoming non-flattenable due to sibling file', () => {
    // a/b would be flattenable alone, but a also has a file
    const files = ['a/file.ts', 'a/b/c/deep.ts'];
    const tree = fileListToTree(files);

    // a has both a file and a folder, so b/c is flattenable from a's perspective
    expect(tree.a.children?.direct).toEqual(['a/file.ts', 'a/b']);
    expect(tree.a.children?.flattened).toEqual(['a/file.ts', 'f::a/b/c']);

    // Root should NOT flatten a since a has multiple children
    expect(tree.root.children?.flattened).toBeUndefined();
  });

  test('should handle paths with extensions that look like folders', () => {
    const files = [
      'src/file.test.ts',
      'src/file.spec.ts',
      'src/components/Button.stories.tsx',
    ];
    const tree = fileListToTree(files);

    expect(tree.src.children?.direct).toContain('src/file.test.ts');
    expect(tree.src.children?.direct).toContain('src/file.spec.ts');
    expect(tree.src.children?.direct).toContain('src/components');

    expect(tree['src/file.test.ts']).toEqual({ name: 'file.test.ts' });
  });
});
