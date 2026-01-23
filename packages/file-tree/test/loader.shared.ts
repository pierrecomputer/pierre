import type { TreeDataLoader } from '@headless-tree/core';
import { describe, expect, test } from 'bun:test';

import type { FileTreeNode } from '../src/types';

export interface LoaderOptions {
  flattenEmptyDirectories?: boolean;
  rootId?: string;
  rootName?: string;
}

export type LoaderFactory = (
  files: string[],
  options?: LoaderOptions
) => TreeDataLoader<FileTreeNode> | Promise<TreeDataLoader<FileTreeNode>>;

/**
 * Creates a shared test suite for tree data loaders.
 * All loaders should pass these tests to ensure consistent behavior.
 *
 * @param name - Name of the loader being tested
 * @param createLoader - Factory function to create the loader
 */
export function createLoaderTests(
  name: string,
  createLoader: LoaderFactory
): void {
  describe(name, () => {
    describe('basic functionality', () => {
      test('should convert a simple file list to tree structure', async () => {
        const files = ['src/index.ts', 'src/utils/helper.ts'];
        const loader = await createLoader(files);

        expect(loader.getItem('root')).toEqual({
          name: 'root',
          children: {
            direct: ['src'],
          },
        });
        // Semantic sort: folders first, then files
        expect(loader.getItem('src')).toEqual({
          name: 'src',
          children: {
            direct: ['src/utils', 'src/index.ts'],
          },
        });
        expect(loader.getItem('src/index.ts')).toEqual({ name: 'index.ts' });
        expect(loader.getItem('src/utils')).toEqual({
          name: 'utils',
          children: {
            direct: ['src/utils/helper.ts'],
          },
        });
        expect(loader.getItem('src/utils/helper.ts')).toEqual({
          name: 'helper.ts',
        });
      });

      test('should handle files at root level', async () => {
        const files = ['README.md', 'package.json'];
        const loader = await createLoader(files);

        // Semantic sort: case-insensitive alphabetical for files
        expect(loader.getItem('root')).toEqual({
          name: 'root',
          children: {
            direct: ['package.json', 'README.md'],
          },
        });
        expect(loader.getItem('README.md')).toEqual({ name: 'README.md' });
        expect(loader.getItem('package.json')).toEqual({
          name: 'package.json',
        });
      });

      test('should handle empty file list', async () => {
        const files: string[] = [];
        const loader = await createLoader(files);

        expect(loader.getItem('root')).toEqual({
          name: 'root',
          children: {
            direct: [],
          },
        });
      });

      test('should support custom root id and name', async () => {
        const files = ['file.ts'];
        const loader = await createLoader(files, {
          rootId: 'my-root',
          rootName: 'Project',
        });

        expect(loader.getItem('my-root')).toEqual({
          name: 'Project',
          children: {
            direct: ['file.ts'],
          },
        });
      });

      test('should handle duplicate file paths', async () => {
        const files = ['src/index.ts', 'src/index.ts', 'src/utils.ts'];
        const loader = await createLoader(files);

        expect(loader.getItem('root').children?.direct).toEqual(['src']);
        expect(loader.getItem('src').children?.direct).toHaveLength(2);
        expect(loader.getItem('src').children?.direct).toContain(
          'src/index.ts'
        );
        expect(loader.getItem('src').children?.direct).toContain(
          'src/utils.ts'
        );
      });
    });

    describe('flattening functionality', () => {
      test('should handle deeply nested files with flattening', async () => {
        const files = ['a/b/c/d/file.ts'];
        const loader = await createLoader(files);

        expect(loader.getItem('root').children?.flattened).toEqual([
          'f::a/b/c/d',
        ]);

        expect(loader.getItem('f::a/b/c/d')).toEqual({
          name: 'a/b/c/d',
          flattens: ['a', 'a/b', 'a/b/c', 'a/b/c/d'],
          children: {
            direct: ['a/b/c/d/file.ts'],
          },
        });
      });

      test('should handle multiple files in the same folder with flattening', async () => {
        const files = [
          'src/components/Button.tsx',
          'src/components/Card.tsx',
          'src/components/Header.tsx',
        ];
        const loader = await createLoader(files);

        expect(loader.getItem('root').children?.flattened).toEqual([
          'f::src/components',
        ]);

        expect(loader.getItem('f::src/components')).toEqual({
          name: 'src/components',
          flattens: ['src', 'src/components'],
          children: {
            direct: [
              'src/components/Button.tsx',
              'src/components/Card.tsx',
              'src/components/Header.tsx',
            ],
          },
        });
      });

      test('should not flatten folders with multiple children', async () => {
        const files = ['folder/file1.ts', 'folder/file2.ts'];
        const loader = await createLoader(files);

        expect(loader.getItem('root').children?.flattened).toBeUndefined();
      });

      test('should not flatten folders when child is a file', async () => {
        const files = ['single/file.ts'];
        const loader = await createLoader(files);

        expect(loader.getItem('root').children?.flattened).toBeUndefined();
      });

      test('should handle mixed depth files', async () => {
        const files = [
          'README.md',
          'src/index.ts',
          'src/utils/deep/nested/file.ts',
        ];
        const loader = await createLoader(files);

        // Semantic sort: folders first, then files
        expect(loader.getItem('root').children?.direct).toEqual([
          'src',
          'README.md',
        ]);
        expect(loader.getItem('root').children?.flattened).toBeUndefined();

        // Semantic sort: flattened folders first, then files
        expect(loader.getItem('src').children?.flattened).toEqual([
          'f::src/utils/deep/nested',
          'src/index.ts',
        ]);

        expect(loader.getItem('f::src/utils/deep/nested')).toEqual({
          name: 'utils/deep/nested',
          flattens: ['src/utils', 'src/utils/deep', 'src/utils/deep/nested'],
          children: {
            direct: ['src/utils/deep/nested/file.ts'],
          },
        });
      });

      test('should handle multiple parallel flattenable chains', async () => {
        const files = [
          'src/feature-a/components/deep/Button.tsx',
          'src/feature-b/utils/helpers/format.ts',
        ];
        const loader = await createLoader(files);

        expect(loader.getItem('src').children?.flattened).toEqual([
          'f::src/feature-a/components/deep',
          'f::src/feature-b/utils/helpers',
        ]);
      });

      test('flattened node should have flattened when its children differ', async () => {
        const files = ['a/b/file.ts', 'a/b/c/d/file2.ts'];
        const loader = await createLoader(files);

        expect(loader.getItem('root').children?.flattened).toEqual(['f::a/b']);

        const flattenedNode = loader.getItem('f::a/b');
        expect(flattenedNode.name).toEqual('a/b');
        expect(flattenedNode.flattens).toEqual(['a', 'a/b']);
        expect(flattenedNode.children?.direct).toEqual([
          'a/b/c',
          'a/b/file.ts',
        ]);
        expect(flattenedNode.children?.flattened).toEqual([
          'f::a/b/c/d',
          'a/b/file.ts',
        ]);
      });

      test('should handle dotfiles and hidden folders', async () => {
        const files = [
          '.gitignore',
          '.github/workflows/ci.yml',
          '.github/workflows/deploy.yml',
          '.vscode/settings.json',
        ];
        const loader = await createLoader(files);

        // Semantic sort: folders first (sorted), then files (sorted)
        expect(loader.getItem('root').children?.direct).toEqual([
          '.github',
          '.vscode',
          '.gitignore',
        ]);
        expect(loader.getItem('root').children?.flattened).toEqual([
          'f::.github/workflows',
          '.vscode',
          '.gitignore',
        ]);

        expect(loader.getItem('f::.github/workflows')).toEqual({
          name: '.github/workflows',
          flattens: ['.github', '.github/workflows'],
          children: {
            direct: [
              '.github/workflows/ci.yml',
              '.github/workflows/deploy.yml',
            ],
          },
        });
      });

      test('should handle file and folder with similar names', async () => {
        const files = [
          'src/utils.ts',
          'src/utils/helper.ts',
          'src/utils/format.ts',
        ];
        const loader = await createLoader(files);

        expect(loader.getItem('src').children?.direct).toEqual([
          'src/utils',
          'src/utils.ts',
        ]);
        expect(loader.getItem('src').children?.flattened).toBeUndefined();

        expect(loader.getItem('src/utils.ts')).toEqual({ name: 'utils.ts' });
        expect(loader.getItem('src/utils')).toEqual({
          name: 'utils',
          children: {
            direct: ['src/utils/format.ts', 'src/utils/helper.ts'],
          },
        });
      });
    });

    describe('getChildren', () => {
      test('should return direct children by default', async () => {
        const files = ['a/b/c/file.ts'];
        const loader = await createLoader(files, {
          flattenEmptyDirectories: false,
        });

        expect(loader.getChildren('root')).toEqual(['a']);
      });

      test('should return flattened children when option is enabled', async () => {
        const files = ['a/b/c/file.ts'];
        const loader = await createLoader(files, {
          flattenEmptyDirectories: true,
        });

        expect(loader.getChildren('root')).toEqual(['f::a/b/c']);
      });

      test('should return empty array for files', async () => {
        const files = ['file.ts'];
        const loader = await createLoader(files);

        expect(loader.getChildren('file.ts')).toEqual([]);
      });
    });

    describe('consistency', () => {
      test('should produce consistent results regardless of input order', async () => {
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

        const loader1 = await createLoader(files1);
        const loader2 = await createLoader(files2);

        // Both should have identical root nodes
        expect(loader1.getItem('root')).toEqual(loader2.getItem('root'));

        // Both should have identical flattened nodes
        expect(loader1.getItem('f::src/a/b/c')).toEqual(
          loader2.getItem('f::src/a/b/c')
        );
        expect(loader1.getItem('f::src/x/y/z')).toEqual(
          loader2.getItem('f::src/x/y/z')
        );
      });
    });

    describe('edge cases', () => {
      test('should handle minimal two-folder flatten', async () => {
        // Simplest flattenable case: just two folders
        const files = ['a/b/file.ts'];
        const loader = await createLoader(files);

        expect(loader.getItem('root').children?.flattened).toEqual(['f::a/b']);

        expect(loader.getItem('f::a/b')).toEqual({
          name: 'a/b',
          flattens: ['a', 'a/b'],
          children: {
            direct: ['a/b/file.ts'],
          },
        });

        // Intermediate folder exists but has no flattened
        expect(loader.getItem('a')).toEqual({
          name: 'a',
          children: {
            direct: ['a/b'],
          },
        });
      });

      test('should handle folder becoming non-flattenable due to sibling file', async () => {
        // a/b would be flattenable alone, but a also has a file
        const files = ['a/file.ts', 'a/b/c/deep.ts'];
        const loader = await createLoader(files);

        // a has both a file and a folder, so b/c is flattenable from a's perspective
        expect(loader.getItem('a').children?.direct).toEqual([
          'a/b',
          'a/file.ts',
        ]);
        expect(loader.getItem('a').children?.flattened).toEqual([
          'f::a/b/c',
          'a/file.ts',
        ]);

        // Root should NOT flatten a since a has multiple children
        expect(loader.getItem('root').children?.flattened).toBeUndefined();
      });

      test('should handle paths with extensions that look like folders', async () => {
        const files = [
          'src/file.test.ts',
          'src/file.spec.ts',
          'src/components/Button.stories.tsx',
        ];
        const loader = await createLoader(files);

        expect(loader.getItem('src').children?.direct).toContain(
          'src/file.test.ts'
        );
        expect(loader.getItem('src').children?.direct).toContain(
          'src/file.spec.ts'
        );
        expect(loader.getItem('src').children?.direct).toContain(
          'src/components'
        );

        expect(loader.getItem('src/file.test.ts')).toEqual({
          name: 'file.test.ts',
        });
      });
    });
  });
}
