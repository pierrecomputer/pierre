import { describe, expect, test } from 'bun:test';

import { fileListToTree } from '../src/utils/fileListToTree';

describe('fileListToTree', () => {
  test('should convert a simple file list to tree structure', () => {
    const files = ['src/index.ts', 'src/utils/helper.ts'];
    const tree = fileListToTree(files);

    // No collapsed since direct and collapsed would be identical
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

    // No collapsed since direct and collapsed would be identical
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

    // Root has collapsed since it differs from direct (collapsed path vs direct folder)
    expect(tree.root).toEqual({
      name: 'root',
      children: {
        direct: ['a'],
        collapsed: ['c::a/b/c/d'],
      },
    });

    // Intermediate folders don't have collapsed (they're part of the chain)
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

    // The endpoint folder - no collapsed since it would be identical to direct
    expect(tree['a/b/c/d']).toEqual({
      name: 'd',
      children: {
        direct: ['a/b/c/d/file.ts'],
      },
    });
    expect(tree['a/b/c/d/file.ts']).toEqual({ name: 'file.ts' });

    // Collapsed node - no collapsed since children would be identical to direct
    expect(tree['c::a/b/c/d']).toEqual({
      name: 'a/b/c/d',
      collapses: ['a', 'a/b', 'a/b/c', 'a/b/c/d'],
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

    // Root has collapsed since it differs from direct
    expect(tree.root).toEqual({
      name: 'root',
      children: {
        direct: ['src'],
        collapsed: ['c::src/components'],
      },
    });

    // src is an intermediate folder (only has one folder child)
    expect(tree.src).toEqual({
      name: 'src',
      children: {
        direct: ['src/components'],
      },
    });

    // src/components is the endpoint, has multiple children - no collapsed since identical
    expect(tree['src/components'].children?.direct).toHaveLength(3);
    expect(tree['src/components'].children?.collapsed).toBeUndefined();

    // Collapsed node - no collapsed since children would be identical to direct
    expect(tree['c::src/components']).toEqual({
      name: 'src/components',
      collapses: ['src', 'src/components'],
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

    // No collapsed since identical to direct
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
    // Root has no collapsed since it has multiple direct children that aren't all collapsible
    expect(tree.root.children?.collapsed).toBeUndefined();

    expect(tree['README.md']).toEqual({ name: 'README.md' });
    expect(tree['src/utils/deep/nested/file.ts']).toEqual({ name: 'file.ts' });

    // src has multiple children (index.ts and utils), so it's not collapsible itself
    // but utils -> deep -> nested is collapsible, so collapsed differs from direct
    expect(tree.src.children?.direct).toContain('src/index.ts');
    expect(tree.src.children?.direct).toContain('src/utils');
    expect(tree.src.children?.collapsed).toContain('src/index.ts');
    expect(tree.src.children?.collapsed).toContain('c::src/utils/deep/nested');

    // The collapsed node - no collapsed since children would be identical to direct
    expect(tree['c::src/utils/deep/nested']).toEqual({
      name: 'utils/deep/nested',
      collapses: ['src/utils', 'src/utils/deep', 'src/utils/deep/nested'],
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

  test('should correctly collapse single-child folder chains', () => {
    // Test case: outer/middle/inner/file.ts where outer->middle->inner is a chain
    const files = ['outer/middle/inner/file.ts'];
    const tree = fileListToTree(files);

    // Root should have collapsed pointing to the fully collapsed path
    expect(tree.root.children?.collapsed).toEqual(['c::outer/middle/inner']);

    // The collapsed node - no collapsed since children would be identical to direct
    expect(tree['c::outer/middle/inner']).toEqual({
      name: 'outer/middle/inner',
      collapses: ['outer', 'outer/middle', 'outer/middle/inner'],
      children: {
        direct: ['outer/middle/inner/file.ts'],
      },
    });
  });

  test('should not collapse folders with multiple children', () => {
    const files = ['folder/file1.ts', 'folder/file2.ts'];
    const tree = fileListToTree(files);

    // folder has 2 children (files), so it shouldn't be collapsed
    // No collapsed since direct and collapsed would be identical
    expect(tree.root.children?.collapsed).toBeUndefined();
    expect(tree['c::folder']).toBeUndefined();
  });

  test('should not collapse folders when child is a file', () => {
    const files = ['single/file.ts'];
    const tree = fileListToTree(files);

    // single has one child that is a file, not a folder, so not collapsible
    // No collapsed since direct and collapsed would be identical
    expect(tree.root.children?.collapsed).toBeUndefined();
    expect(tree['c::single']).toBeUndefined();
  });

  test('should only include collapsed when it differs from direct', () => {
    // This test verifies that collapsed is only present when it contains
    // different entries than direct (i.e., has c:: prefixed paths)
    const files = [
      'src/simple/file.ts', // src/simple is not collapsible (file child)
      'src/deep/nested/inner/file.ts', // src/deep/nested/inner is collapsible
    ];
    const tree = fileListToTree(files);

    // src has two children: simple (not collapsible) and deep (collapsible)
    // So collapsed differs from direct
    expect(tree.src.children?.direct).toEqual(['src/simple', 'src/deep']);
    expect(tree.src.children?.collapsed).toEqual([
      'src/simple',
      'c::src/deep/nested/inner',
    ]);

    // src/simple has no collapsed (would be identical to direct)
    expect(tree['src/simple'].children?.direct).toEqual(['src/simple/file.ts']);
    expect(tree['src/simple'].children?.collapsed).toBeUndefined();

    // Verify the collapsed node exists and has no collapsed (identical to direct)
    expect(tree['c::src/deep/nested/inner']).toEqual({
      name: 'deep/nested/inner',
      collapses: ['src/deep', 'src/deep/nested', 'src/deep/nested/inner'],
      children: {
        direct: ['src/deep/nested/inner/file.ts'],
      },
    });
  });

  test('collapsed node should have collapsed when its children differ', () => {
    // A collapsed node that itself contains collapsible children
    const files = [
      'a/b/file.ts', // a/b is the endpoint of a->b chain
      'a/b/c/d/file2.ts', // c/d is collapsible within a/b
    ];
    const tree = fileListToTree(files);

    // Root collapses a/b
    expect(tree.root.children?.collapsed).toEqual(['c::a/b']);

    // The collapsed node a/b has children that differ (c is collapsible)
    expect(tree['c::a/b']).toEqual({
      name: 'a/b',
      collapses: ['a', 'a/b'],
      children: {
        direct: ['a/b/file.ts', 'a/b/c'],
        collapsed: ['a/b/file.ts', 'c::a/b/c/d'],
      },
    });

    // Nested collapsed node
    expect(tree['c::a/b/c/d']).toEqual({
      name: 'c/d',
      collapses: ['a/b/c', 'a/b/c/d'],
      children: {
        direct: ['a/b/c/d/file2.ts'],
      },
    });
  });

  test('should handle multiple parallel collapsible chains', () => {
    // Two sibling folders that are both independently collapsible
    const files = [
      'src/feature-a/components/deep/Button.tsx',
      'src/feature-b/utils/helpers/format.ts',
    ];
    const tree = fileListToTree(files);

    // src has two collapsible children
    expect(tree.src.children?.direct).toEqual([
      'src/feature-a',
      'src/feature-b',
    ]);
    expect(tree.src.children?.collapsed).toEqual([
      'c::src/feature-a/components/deep',
      'c::src/feature-b/utils/helpers',
    ]);

    // Both collapsed nodes should exist
    expect(tree['c::src/feature-a/components/deep']).toEqual({
      name: 'feature-a/components/deep',
      collapses: [
        'src/feature-a',
        'src/feature-a/components',
        'src/feature-a/components/deep',
      ],
      children: {
        direct: ['src/feature-a/components/deep/Button.tsx'],
      },
    });

    expect(tree['c::src/feature-b/utils/helpers']).toEqual({
      name: 'feature-b/utils/helpers',
      collapses: [
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

    // .github/workflows is collapsible (single folder child)
    expect(tree.root.children?.collapsed).toContain('c::.github/workflows');

    expect(tree['.gitignore']).toEqual({ name: '.gitignore' });

    expect(tree['c::.github/workflows']).toEqual({
      name: '.github/workflows',
      collapses: ['.github', '.github/workflows'],
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

    // No collapsed since utils folder has multiple children (not collapsible)
    expect(tree.src.children?.collapsed).toBeUndefined();

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

    // Both should have the same collapsed nodes
    expect(tree1['c::src/a/b/c']).toBeDefined();
    expect(tree2['c::src/a/b/c']).toBeDefined();
    expect(tree1['c::src/x/y/z']).toBeDefined();
    expect(tree2['c::src/x/y/z']).toBeDefined();

    // The collapsed nodes should have the same collapses arrays
    expect(tree1['c::src/a/b/c'].collapses).toEqual(
      tree2['c::src/a/b/c'].collapses
    );
  });

  test('should handle minimal two-folder collapse', () => {
    // Simplest collapsible case: just two folders
    const files = ['a/b/file.ts'];
    const tree = fileListToTree(files);

    expect(tree.root.children?.collapsed).toEqual(['c::a/b']);

    expect(tree['c::a/b']).toEqual({
      name: 'a/b',
      collapses: ['a', 'a/b'],
      children: {
        direct: ['a/b/file.ts'],
      },
    });

    // Intermediate folder exists but has no collapsed
    expect(tree.a).toEqual({
      name: 'a',
      children: {
        direct: ['a/b'],
      },
    });
  });

  test('should handle folder becoming non-collapsible due to sibling file', () => {
    // a/b would be collapsible alone, but a also has a file
    const files = ['a/file.ts', 'a/b/c/deep.ts'];
    const tree = fileListToTree(files);

    // a has both a file and a folder, so b/c is collapsible from a's perspective
    expect(tree.a.children?.direct).toEqual(['a/file.ts', 'a/b']);
    expect(tree.a.children?.collapsed).toEqual(['a/file.ts', 'c::a/b/c']);

    // Root should NOT collapse a since a has multiple children
    expect(tree.root.children?.collapsed).toBeUndefined();
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
