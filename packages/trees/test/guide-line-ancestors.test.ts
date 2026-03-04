import { describe, expect, test } from 'bun:test';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';

import { Root } from '../src/components/Root';
import type { FileTreeData } from '../src/types';
import { fileListToTree } from '../src/utils/fileListToTree';
import {
  buildAncestorChains,
  buildChildToParent,
} from '../src/utils/guideLineAncestors';

/**
 * Helper: given treeData, find the node ID whose path matches the given path.
 * Works for both regular and flattened nodes.
 */
function idForPath(treeData: FileTreeData, path: string): string {
  for (const [id, node] of Object.entries(treeData)) {
    if (node.path === path) return id;
  }
  throw new Error(`No node found for path: ${path}`);
}

/**
 * Helper: resolve an ancestor chain to paths for readable assertions.
 */
function chainAsPaths(treeData: FileTreeData, chain: string[]): string[] {
  return chain.map((id) => {
    const node = treeData[id];
    if (node == null) throw new Error(`No node for id: ${id}`);
    return node.path;
  });
}

describe('buildChildToParent (no flattening)', () => {
  const files = [
    'README.md',
    'src/index.ts',
    'src/components/Button.tsx',
    'src/components/Card.tsx',
  ];
  const treeData = fileListToTree(files);

  test('root-level items have root as parent', () => {
    const map = buildChildToParent(treeData, false);
    const readmeId = idForPath(treeData, 'README.md');
    const srcId = idForPath(treeData, 'src');
    expect(map.get(readmeId)).toBe('root');
    expect(map.get(srcId)).toBe('root');
  });

  test('nested file maps to its direct parent folder', () => {
    const map = buildChildToParent(treeData, false);
    const buttonId = idForPath(treeData, 'src/components/Button.tsx');
    const componentsId = idForPath(treeData, 'src/components');
    expect(map.get(buttonId)).toBe(componentsId);
  });

  test('deeply nested file maps to its immediate parent, not grandparent', () => {
    const deepFiles = [
      'Build/assets/images/social/logo.png',
      'Build/assets/images/social/banner.png',
    ];
    const data = fileListToTree(deepFiles);
    const map = buildChildToParent(data, false);
    const logoId = idForPath(data, 'Build/assets/images/social/logo.png');
    const socialId = idForPath(data, 'Build/assets/images/social');
    expect(map.get(logoId)).toBe(socialId);
  });
});

describe('buildChildToParent (with flattening)', () => {
  test('children of flattened dir map to earliest segment', () => {
    // a/b has only one child chain, so a/b gets flattened
    const files = ['a/b/file1.ts', 'a/b/file2.ts'];
    const treeData = fileListToTree(files);
    const map = buildChildToParent(treeData, true);

    const file1Id = idForPath(treeData, 'a/b/file1.ts');
    const aId = idForPath(treeData, 'a');
    // Parent should be the earliest segment of the flattened chain
    expect(map.get(file1Id)).toBe(aId);
  });

  test('flattened composite node maps to its visual parent', () => {
    const files = ['src/components/utils/helper.ts', 'src/index.ts'];
    const treeData = fileListToTree(files);
    const map = buildChildToParent(treeData, true);

    // components/utils is flattened under src
    // The composite node should map to src
    const srcId = idForPath(treeData, 'src');

    // Find the composite node (has flattens property)
    const compositeEntry = Object.entries(treeData).find(
      ([, node]) => node.flattens != null && node.flattens.length > 0
    );
    expect(compositeEntry).toBeDefined();
    const compositeId = compositeEntry![0];
    expect(map.get(compositeId)).toBe(srcId);
  });

  test('sibling of flattened dir shares the same parent', () => {
    const files = ['src/components/utils/helper.ts', 'src/index.ts'];
    const treeData = fileListToTree(files);
    const map = buildChildToParent(treeData, true);

    const srcId = idForPath(treeData, 'src');
    const indexId = idForPath(treeData, 'src/index.ts');
    expect(map.get(indexId)).toBe(srcId);
  });

  test('nested flattened composite maps to its visible parent segment', () => {
    const files = ['a/b/c/d/e/f.txt', 'a/b/c/x.ts'];
    const treeData = fileListToTree(files);
    const map = buildChildToParent(treeData, true);

    const aId = idForPath(treeData, 'a');
    const nestedCompositeId = idForPath(treeData, 'f::a/b/c/d/e');
    expect(map.get(nestedCompositeId)).toBe(aId);
  });
});

describe('buildAncestorChains (no flattening)', () => {
  const files = ['README.md', 'src/index.ts', 'src/components/Button.tsx'];
  const treeData = fileListToTree(files);
  const childToParent = buildChildToParent(treeData, false);
  const chains = buildAncestorChains(treeData, childToParent);

  test('root-level items have empty ancestor chain', () => {
    const readmeId = idForPath(treeData, 'README.md');
    expect(chains.get(readmeId)).toEqual([]);
  });

  test('level-1 items have their parent as sole ancestor', () => {
    const indexId = idForPath(treeData, 'src/index.ts');
    const srcId = idForPath(treeData, 'src');
    expect(chains.get(indexId)).toEqual([srcId]);
  });

  test('level-2 items have ancestors ordered root-outward', () => {
    const buttonId = idForPath(treeData, 'src/components/Button.tsx');
    const chain = chains.get(buttonId)!;
    const paths = chainAsPaths(treeData, chain);
    expect(paths).toEqual(['src', 'src/components']);
  });

  test('deeply nested chain is in root-outward order', () => {
    const deepFiles = [
      'Build/assets/images/social/logo.png',
      'Build/assets/images/social/banner.png',
    ];
    const data = fileListToTree(deepFiles);
    const map = buildChildToParent(data, false);
    const deepChains = buildAncestorChains(data, map);

    const logoId = idForPath(data, 'Build/assets/images/social/logo.png');
    const chain = deepChains.get(logoId)!;
    const paths = chainAsPaths(data, chain);
    expect(paths).toEqual([
      'Build',
      'Build/assets',
      'Build/assets/images',
      'Build/assets/images/social',
    ]);
  });

  test('last ancestor in chain is the direct parent', () => {
    const deepFiles = [
      'Build/assets/images/social/logo.png',
      'Build/assets/images/social/banner.png',
    ];
    const data = fileListToTree(deepFiles);
    const map = buildChildToParent(data, false);
    const deepChains = buildAncestorChains(data, map);

    const logoId = idForPath(data, 'Build/assets/images/social/logo.png');
    const socialId = idForPath(data, 'Build/assets/images/social');
    const chain = deepChains.get(logoId)!;
    expect(chain[chain.length - 1]).toBe(socialId);
  });
});

describe('buildAncestorChains (with flattening)', () => {
  test('file inside flattened dir has earliest segment as last ancestor', () => {
    const files = ['a/b/file.ts', 'a/b/other.ts'];
    const treeData = fileListToTree(files);
    const map = buildChildToParent(treeData, true);
    const chains = buildAncestorChains(treeData, map);

    const fileId = idForPath(treeData, 'a/b/file.ts');
    const aId = idForPath(treeData, 'a');
    const chain = chains.get(fileId)!;
    expect(chain).toEqual([aId]);
  });

  test('flattened composite node has its visual parent as ancestor', () => {
    const files = ['src/components/utils/helper.ts', 'src/index.ts'];
    const treeData = fileListToTree(files);
    const map = buildChildToParent(treeData, true);
    const chains = buildAncestorChains(treeData, map);

    const srcId = idForPath(treeData, 'src');
    const compositeEntry = Object.entries(treeData).find(
      ([, node]) => node.flattens != null && node.flattens.length > 0
    )!;
    const chain = chains.get(compositeEntry[0])!;
    expect(chain).toEqual([srcId]);
  });

  test('sibling of flattened dir has correct ancestor chain', () => {
    const files = ['src/components/utils/helper.ts', 'src/index.ts'];
    const treeData = fileListToTree(files);
    const map = buildChildToParent(treeData, true);
    const chains = buildAncestorChains(treeData, map);

    const indexId = idForPath(treeData, 'src/index.ts');
    const srcId = idForPath(treeData, 'src');
    expect(chains.get(indexId)).toEqual([srcId]);
  });

  test('nested flattened composite has visible parent in ancestor chain', () => {
    const files = ['a/b/c/d/e/f.txt', 'a/b/c/x.ts'];
    const treeData = fileListToTree(files);
    const map = buildChildToParent(treeData, true);
    const chains = buildAncestorChains(treeData, map);

    const aId = idForPath(treeData, 'a');
    const nestedCompositeId = idForPath(treeData, 'f::a/b/c/d/e');
    expect(chains.get(nestedCompositeId)).toEqual([aId]);
  });

  test('file inside nested flattened composite has root-outward ancestors', () => {
    const files = ['a/b/c/d/e/f.txt', 'a/b/c/x.ts'];
    const treeData = fileListToTree(files);
    const map = buildChildToParent(treeData, true);
    const chains = buildAncestorChains(treeData, map);

    const fileId = idForPath(treeData, 'a/b/c/d/e/f.txt');
    const chain = chains.get(fileId)!;
    const paths = chainAsPaths(treeData, chain);
    expect(paths).toEqual(['a', 'a/b/c/d']);
  });
});

describe('SSR guide-line style output', () => {
  function renderTree(
    files: string[],
    opts: {
      flattenEmptyDirectories?: boolean;
      initialExpandedItems?: string[];
      initialSelectedItems?: string[];
    }
  ): string {
    return renderToString(
      h(Root, {
        fileTreeOptions: {
          initialFiles: files,
          flattenEmptyDirectories: opts.flattenEmptyDirectories ?? false,
          id: 'ssr-test',
        },
        stateConfig: {
          initialExpandedItems: opts.initialExpandedItems,
          initialSelectedItems: opts.initialSelectedItems,
        },
      })
    );
  }

  test('no style element when nothing is selected', () => {
    const html = renderTree(['src/index.ts'], {
      initialExpandedItems: ['src'],
    });
    expect(html).not.toContain('opacity: 1');
  });

  test('style element contains valid CSS with unescaped quotes', () => {
    const html = renderTree(['src/index.ts', 'src/lib/utils.ts'], {
      initialExpandedItems: ['src'],
      initialSelectedItems: ['src/index.ts'],
    });
    expect(html).toContain('opacity: 1');
    // Ensure quotes are real quotes, not HTML entities
    expect(html).not.toContain('&quot;');
    const styleMatch = html.match(/<style>(.*?)<\/style>/);
    expect(styleMatch).not.toBeNull();
    expect(styleMatch![1]).toContain('data-ancestor-id=');
  });

  test('data-ancestor-id attributes are present on spacing items', () => {
    const html = renderTree(['src/components/Button.tsx', 'src/index.ts'], {
      initialExpandedItems: ['src', 'src/components'],
      initialSelectedItems: ['src/components/Button.tsx'],
    });
    expect(html).toMatch(/data-ancestor-id="[^"]+"/);
  });

  test('style selector ID matches a data-ancestor-id in the markup', () => {
    const html = renderTree(['src/components/Button.tsx', 'src/index.ts'], {
      initialExpandedItems: ['src', 'src/components'],
      initialSelectedItems: ['src/components/Button.tsx'],
    });
    const styleMatch = html.match(/<style>(.*?)<\/style>/);
    expect(styleMatch).not.toBeNull();
    // Extract the ancestor ID from the CSS selector
    const cssIdMatch = styleMatch![1].match(/data-ancestor-id="([^"]+)"/);
    expect(cssIdMatch).not.toBeNull();
    const cssAncestorId = cssIdMatch![1];
    // The same ID should appear as an attribute in the HTML
    expect(html).toContain(`data-ancestor-id="${cssAncestorId}"`);
  });

  test('SSR works with flattened directories', () => {
    const html = renderTree(
      ['src/components/utils/helper.ts', 'src/index.ts'],
      {
        flattenEmptyDirectories: true,
        initialExpandedItems: ['src', 'src/components/utils'],
        initialSelectedItems: ['src/components/utils/helper.ts'],
      }
    );
    expect(html).toContain('opacity: 1');
    expect(html).not.toContain('&quot;');
    // Style selector ID should match an attribute in the markup
    const styleMatch = html.match(/<style>(.*?)<\/style>/);
    expect(styleMatch).not.toBeNull();
    const cssIdMatch = styleMatch![1].match(/data-ancestor-id="([^"]+)"/);
    expect(cssIdMatch).not.toBeNull();
    expect(html).toContain(`data-ancestor-id="${cssIdMatch![1]}"`);
  });
});
