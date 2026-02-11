import { describe, expect, test } from 'bun:test';

import { FLATTENED_PREFIX } from '../src/constants';
import {
  expandPathsWithAncestors,
  filterOrphanedPaths,
} from '../src/utils/expandPaths';
import { fileListToTree } from '../src/utils/fileListToTree';

/**
 * Builds pathToId and idToPath maps from a file list, mirroring Root.tsx:79-87.
 */
function buildMaps(files: string[]) {
  const treeData = fileListToTree(files);
  const pathToId = new Map<string, string>();
  const idToPath = new Map<string, string>();
  for (const [id, node] of Object.entries(treeData)) {
    pathToId.set(node.path, id);
    idToPath.set(id, node.path);
  }
  return { pathToId, idToPath, treeData };
}

/**
 * Strip flattened prefix from a path, matching Root.tsx:34-37.
 */
function getSelectionPath(path: string): string {
  return path.startsWith(FLATTENED_PREFIX)
    ? path.slice(FLATTENED_PREFIX.length)
    : path;
}

describe('expandPathsWithAncestors', () => {
  test('leaf path includes all ancestors', () => {
    const { pathToId } = buildMaps([
      'src/components/Button.tsx',
      'src/lib/utils.ts',
    ]);
    const ids = expandPathsWithAncestors(
      ['src/components/Button.tsx'],
      pathToId
    );
    // Should include: src, src/components, src/components/Button.tsx
    // (or their flattened equivalents)
    expect(ids.length).toBeGreaterThanOrEqual(2);
    // Must include the leaf's nearest folder ancestor
    const srcComponentsId =
      pathToId.get('f::src/components') ?? pathToId.get('src/components');
    expect(ids).toContain(srcComponentsId!);
  });

  test('prefers flattened f:: ID when both exist and flatten is on', () => {
    const { pathToId } = buildMaps([
      'src/components/deep/Button.tsx',
      'src/components/deep/Card.tsx',
    ]);
    // With these files, src/components/deep gets a flattened entry f::src/components/deep
    const flatId = pathToId.get('f::src/components/deep');
    const regularId = pathToId.get('src/components/deep');
    // Both should be in the map
    expect(flatId).toBeDefined();
    expect(regularId).toBeDefined();

    const ids = expandPathsWithAncestors(
      ['src/components/deep/Button.tsx'],
      pathToId,
      { flattenEmptyDirectories: true }
    );
    // Should contain the flattened ID, not the regular one
    expect(ids).toContain(flatId!);
    expect(ids).not.toContain(regularId!);
  });

  test('uses regular ID when flatten is off even if f:: exists', () => {
    const { pathToId } = buildMaps([
      'src/components/deep/Button.tsx',
      'src/components/deep/Card.tsx',
    ]);
    const flatId = pathToId.get('f::src/components/deep');
    const regularId = pathToId.get('src/components/deep');
    expect(flatId).toBeDefined();
    expect(regularId).toBeDefined();

    const ids = expandPathsWithAncestors(
      ['src/components/deep/Button.tsx'],
      pathToId,
      { flattenEmptyDirectories: false }
    );
    // Should contain the regular ID, not the flattened one
    expect(ids).toContain(regularId!);
    expect(ids).not.toContain(flatId!);
  });

  test('falls back to regular ID when no flattened variant', () => {
    const { pathToId } = buildMaps(['src/index.ts', 'src/utils/helper.ts']);
    // src has two children so it's not flattened
    const srcId = pathToId.get('src');
    const flatSrcId = pathToId.get('f::src');
    expect(srcId).toBeDefined();
    expect(flatSrcId).toBeUndefined();

    const ids = expandPathsWithAncestors(['src/index.ts'], pathToId);
    expect(ids).toContain(srcId!);
  });

  test('empty input returns empty output', () => {
    const { pathToId } = buildMaps(['src/index.ts']);
    const ids = expandPathsWithAncestors([], pathToId);
    expect(ids).toEqual([]);
  });

  test('unknown paths are skipped gracefully', () => {
    const { pathToId } = buildMaps(['src/index.ts']);
    const ids = expandPathsWithAncestors(
      ['nonexistent/path/file.ts'],
      pathToId
    );
    expect(ids).toEqual([]);
  });

  test('multiple paths with overlapping ancestors deduplicate', () => {
    const { pathToId } = buildMaps(['src/a.ts', 'src/b.ts']);
    const ids = expandPathsWithAncestors(['src/a.ts', 'src/b.ts'], pathToId);
    // src should appear only once
    const srcId = pathToId.get('src')!;
    expect(ids.filter((id) => id === srcId)).toHaveLength(1);
  });

  test('round-trip: IDs → paths → expandPathsWithAncestors = same IDs', () => {
    const files = [
      'README.md',
      'src/index.ts',
      'src/components/Button.tsx',
      'src/components/Card.tsx',
      'src/lib/utils.ts',
    ];
    const { pathToId, idToPath } = buildMaps(files);

    // Simulate expanding src/components and src/lib
    const initialPaths = ['src/components/Button.tsx', 'src/lib/utils.ts'];
    const expandedIds = expandPathsWithAncestors(initialPaths, pathToId);

    // Now convert IDs back to paths (stripping f:: prefix), as the
    // onExpandedItemsChange callback does (Root.tsx:346-354)
    const roundTrippedPaths = [
      ...new Set(
        expandedIds
          .map((id) => idToPath.get(id))
          .filter((path): path is string => path != null)
          .map(getSelectionPath)
      ),
    ];

    // Feed those paths back into expandPathsWithAncestors
    const roundTrippedIds = expandPathsWithAncestors(
      roundTrippedPaths,
      pathToId
    );

    // The IDs should be identical — this guards against the controlled-state
    // feedback loop where round-tripping adds extra IDs.
    expect(roundTrippedIds.sort()).toEqual(expandedIds.sort());
  });

  test('round-trip with deeply nested flattened paths', () => {
    const files = ['a/b/c/d/e/file.ts'];
    const { pathToId, idToPath } = buildMaps(files);

    const initialPaths = ['a/b/c/d/e/file.ts'];
    const expandedIds = expandPathsWithAncestors(initialPaths, pathToId);

    const roundTrippedPaths = [
      ...new Set(
        expandedIds
          .map((id) => idToPath.get(id))
          .filter((path): path is string => path != null)
          .map(getSelectionPath)
      ),
    ];

    const roundTrippedIds = expandPathsWithAncestors(
      roundTrippedPaths,
      pathToId
    );

    expect(roundTrippedIds.sort()).toEqual(expandedIds.sort());
  });
});

describe('filterOrphanedPaths', () => {
  test('root-level paths are always kept', () => {
    const { pathToId } = buildMaps(['src/index.ts', 'lib/utils.ts']);
    const result = filterOrphanedPaths(['src', 'lib'], pathToId);
    expect(result).toEqual(['src', 'lib']);
  });

  test('paths with all ancestors expanded are kept', () => {
    const { pathToId } = buildMaps([
      'src/components/Button.tsx',
      'src/components/Card.tsx',
      'src/index.ts',
    ]);
    const result = filterOrphanedPaths(['src', 'src/components'], pathToId);
    expect(result).toContain('src');
    expect(result).toContain('src/components');
  });

  test('paths with collapsed ancestor are filtered out', () => {
    const { pathToId } = buildMaps([
      'Build/assets/images/social/og.png',
      'Build/assets/images/logo.png',
      'Build/config.json',
    ]);
    // Build is collapsed but its descendants are still in the list
    const result = filterOrphanedPaths(
      ['Build/assets', 'Build/assets/images', 'Build/assets/images/social'],
      pathToId
    );
    // All should be filtered — Build is not in the expanded set
    expect(result).toEqual([]);
  });

  test('intermediate non-node ancestors are skipped', () => {
    // Simulate a pathToId where intermediate segments are not real tree nodes
    // (e.g. a tree that only knows about "a/b/c" as a flattened node, not "a" or "a/b")
    const pathToId = new Map<string, string>();
    pathToId.set('a/b/c', 'id-abc');
    pathToId.set('a/b/c/file1.ts', 'id-file1');
    // "a" and "a/b" are NOT in pathToId — they're not real tree nodes
    const result = filterOrphanedPaths(['a/b/c'], pathToId);
    expect(result).toEqual(['a/b/c']);
  });

  test('empty input returns empty output', () => {
    const { pathToId } = buildMaps(['src/index.ts']);
    const result = filterOrphanedPaths([], pathToId);
    expect(result).toEqual([]);
  });

  test('flattened path kept when only visible parent is expanded (flatten on)', () => {
    // Build has multiple children (not interior), but Build/assets is a
    // single-child directory (interior to the flattened chain).
    // filterOrphanedPaths should skip the interior ancestor.
    const { pathToId } = buildMaps([
      'Build/index.mjs',
      'Build/scripts.js',
      'Build/assets/images/social/logo.png',
    ]);
    const result = filterOrphanedPaths(
      ['Build', 'Build/assets/images/social'],
      pathToId,
      true
    );
    expect(result).toContain('Build');
    expect(result).toContain('Build/assets/images/social');
  });

  test('flattened path filtered when visible parent is collapsed', () => {
    const { pathToId } = buildMaps([
      'Build/index.mjs',
      'Build/scripts.js',
      'Build/assets/images/social/logo.png',
    ]);
    // Build is NOT in the expanded set — it's collapsed
    const result = filterOrphanedPaths(
      ['Build/assets/images/social'],
      pathToId,
      true
    );
    expect(result).toEqual([]);
  });

  test('does not skip interior ancestors when flatten is off', () => {
    // When flattenEmptyDirectories is false, every folder is a real visible
    // node — even single-child directories. So Build/assets must be in the
    // expanded set for Build/assets/images to be kept.
    const { pathToId } = buildMaps([
      'Build/index.mjs',
      'Build/scripts.js',
      'Build/assets/images/social/logo.png',
    ]);
    // With flatten off, Build/assets/images/social requires all ancestors
    const result = filterOrphanedPaths(
      ['Build', 'Build/assets/images/social'],
      pathToId,
      false
    );
    // Build is kept (root-level), but Build/assets/images/social is orphaned
    // because Build/assets is not in the expanded set
    expect(result).toContain('Build');
    expect(result).not.toContain('Build/assets/images/social');
  });

  test('all ancestors expanded keeps path when flatten is off', () => {
    const { pathToId } = buildMaps([
      'Build/index.mjs',
      'Build/scripts.js',
      'Build/assets/images/social/logo.png',
    ]);
    const result = filterOrphanedPaths(
      [
        'Build',
        'Build/assets',
        'Build/assets/images',
        'Build/assets/images/social',
      ],
      pathToId,
      false
    );
    expect(result).toContain('Build');
    expect(result).toContain('Build/assets');
    expect(result).toContain('Build/assets/images');
    expect(result).toContain('Build/assets/images/social');
  });
});
