import { describe, expect, test } from 'bun:test';

import { fileListToTree } from '../src/utils/fileListToTree';

describe('fileListToTree', () => {
  test('should convert a simple file list to tree structure', () => {
    const files = ['src/index.ts', 'src/utils/helper.ts'];
    const tree = fileListToTree(files);

    expect(tree).toEqual({
      root: { name: 'root', children: ['src'] },
      src: { name: 'src', children: ['src/index.ts', 'src/utils'] },
      'src/index.ts': { name: 'index.ts' },
      'src/utils': { name: 'utils', children: ['src/utils/helper.ts'] },
      'src/utils/helper.ts': { name: 'helper.ts' },
    });
  });

  test('should handle files at root level', () => {
    const files = ['README.md', 'package.json'];
    const tree = fileListToTree(files);

    expect(tree).toEqual({
      root: { name: 'root', children: ['README.md', 'package.json'] },
      'README.md': { name: 'README.md' },
      'package.json': { name: 'package.json' },
    });
  });

  test('should handle deeply nested files', () => {
    const files = ['a/b/c/d/file.ts'];
    const tree = fileListToTree(files);

    expect(tree).toEqual({
      root: { name: 'root', children: ['a'] },
      a: { name: 'a', children: ['a/b'] },
      'a/b': { name: 'b', children: ['a/b/c'] },
      'a/b/c': { name: 'c', children: ['a/b/c/d'] },
      'a/b/c/d': { name: 'd', children: ['a/b/c/d/file.ts'] },
      'a/b/c/d/file.ts': { name: 'file.ts' },
    });
  });

  test('should handle multiple files in the same folder', () => {
    const files = [
      'src/components/Button.tsx',
      'src/components/Card.tsx',
      'src/components/Header.tsx',
    ];
    const tree = fileListToTree(files);

    expect(tree.root).toEqual({ name: 'root', children: ['src'] });
    expect(tree.src).toEqual({ name: 'src', children: ['src/components'] });
    expect(tree['src/components'].children).toHaveLength(3);
    expect(tree['src/components'].children).toContain(
      'src/components/Button.tsx'
    );
    expect(tree['src/components'].children).toContain(
      'src/components/Card.tsx'
    );
    expect(tree['src/components'].children).toContain(
      'src/components/Header.tsx'
    );
  });

  test('should handle duplicate file paths', () => {
    const files = ['src/index.ts', 'src/index.ts', 'src/utils.ts'];
    const tree = fileListToTree(files);

    expect(tree.root.children).toEqual(['src']);
    expect(tree.src.children).toHaveLength(2);
    expect(tree.src.children).toContain('src/index.ts');
    expect(tree.src.children).toContain('src/utils.ts');
  });

  test('should support custom root id and name', () => {
    const files = ['file.ts'];
    const tree = fileListToTree(files, {
      rootId: 'my-root',
      rootName: 'Project',
    });

    expect(tree['my-root']).toEqual({
      name: 'Project',
      children: ['file.ts'],
    });
    expect(tree.root).toBeUndefined();
  });

  test('should handle empty file list', () => {
    const files: string[] = [];
    const tree = fileListToTree(files);

    expect(tree).toEqual({
      root: { name: 'root', children: [] },
    });
  });

  test('should handle mixed depth files', () => {
    const files = [
      'README.md',
      'src/index.ts',
      'src/utils/deep/nested/file.ts',
    ];
    const tree = fileListToTree(files);

    expect(tree.root.children).toContain('README.md');
    expect(tree.root.children).toContain('src');
    expect(tree['README.md']).toEqual({ name: 'README.md' });
    expect(tree['src/utils/deep/nested/file.ts']).toEqual({ name: 'file.ts' });
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
});
