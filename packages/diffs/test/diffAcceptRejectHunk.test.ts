import { describe, expect, test } from 'bun:test';

import type {
  ChangeContent,
  ContextContent,
  FileDiffMetadata,
} from '../src/types';
import { diffAcceptRejectHunk } from '../src/utils/diffAcceptRejectHunk';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { parseMergeConflictDiffFromFile } from '../src/utils/parseMergeConflictDiffFromFile';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';
import { resolveConflict } from '../src/utils/resolveConflict';
import { verifyFileDiffHunkValues } from './testUtils';

type ResolvedType = 'accept' | 'reject' | 'both';

interface ContextBlockSnapshot {
  type: 'context';
  lines: string[];
}

interface ChangeBlockSnapshot {
  type: 'change';
  deletionLines: string[];
  additionLines: string[];
}

type BlockSnapshot = ContextBlockSnapshot | ChangeBlockSnapshot;

interface HunkSnapshot {
  blocks: BlockSnapshot[];
}

// Create one realistic parsed diff with several hunk shapes. The tests use
// this as the starting point, then check whether resolving one hunk leaves the
// resulting diff metadata internally consistent.
function createFixture() {
  const oldContents = [
    'line 01 stable',
    'line 02 add anchor',
    'line 03 stable',
    'line 04 stable',
    'line 05 stable',
    'line 06 delete me',
    'line 07 stable',
    'line 08 stable',
    'line 09 stable',
    'line 10 replace old',
    'line 11 stable',
    'line 12 stable',
    'line 13 stable',
    'line 14 mix old a',
    'line 15 mix shared',
    'line 16 mix old b',
    'line 17 stable',
    '',
  ].join('\n');
  const newContents = [
    'line 01 stable',
    'line 02 add anchor',
    'line 02.1 add first',
    'line 02.2 add second',
    'line 03 stable',
    'line 04 stable',
    'line 05 stable',
    'line 07 stable',
    'line 08 stable',
    'line 09 stable',
    'line 10 replace new',
    'line 11 stable',
    'line 12 stable',
    'line 13 stable',
    'line 14 mix new a',
    'line 15 mix shared',
    'line 16 mix new b',
    'line 17 stable',
    '',
  ].join('\n');

  return parseDiffFromFile(
    { name: 'example.ts', contents: oldContents },
    { name: 'example.ts', contents: newContents },
    { context: 1 }
  );
}

function createPartialFixture() {
  const patch = `diff --git a/index.html b/index.html
index 36c553c..711c67c 100644
--- a/index.html
+++ b/index.html
@@ -6,8 +6,9 @@
 </head>
 <body>
 <header>
-  <h1>Welcome</h1>
-  <p>Thanks for visiting</p>
+  <h1>Welcome to Our Site</h1>
+  <p>We're glad you're here</p>
+  <a href="/about" class="btn">Learn More</a>
 </header>
 <footer>
   <p>&copy; Acme Inc.</p>`;

  const diff = parsePatchFiles(patch)[0]?.files[0];
  if (diff == null) {
    throw new Error('Failed to parse partial patch fixture');
  }

  return diff;
}

// Convert a hunk into plain derived data that records the exact line content
// each block currently points at. Just an in-memory copy of the hunk's
// referenced lines.
function snapshotHunk(diff: FileDiffMetadata, hunkIndex: number): HunkSnapshot {
  const hunk = diff.hunks[hunkIndex];
  if (hunk == null) {
    throw new Error(`Missing hunk ${hunkIndex}`);
  }

  return {
    blocks: hunk.hunkContent.map((content) => snapshotBlock(diff, content)),
  };
}

// Read the actual lines referenced by one content block. This lets the tests
// compare line-indexed blocks before and after another hunk has been resolved.
function snapshotBlock(
  diff: FileDiffMetadata,
  content: ContextContent | ChangeContent
): BlockSnapshot {
  if (content.type === 'context') {
    return {
      type: 'context',
      lines: diff.additionLines.slice(
        content.additionLineIndex,
        content.additionLineIndex + content.lines
      ),
    };
  }

  return {
    type: 'change',
    deletionLines: diff.deletionLines.slice(
      content.deletionLineIndex,
      content.deletionLineIndex + content.deletions
    ),
    additionLines: diff.additionLines.slice(
      content.additionLineIndex,
      content.additionLineIndex + content.additions
    ),
  };
}

// Build the line sequence that the resolved hunk should contain after an
// accept, reject, or both operation, based on the original derived block data
// collected before the diff was changed.
function getResolvedLines(
  snapshot: HunkSnapshot,
  type: ResolvedType
): string[] {
  const resolvedLines: string[] = [];

  for (const block of snapshot.blocks) {
    if (block.type === 'context') {
      resolvedLines.push(...block.lines);
    } else if (type === 'accept') {
      resolvedLines.push(...block.additionLines);
    } else if (type === 'reject') {
      resolvedLines.push(...block.deletionLines);
    } else {
      resolvedLines.push(...block.deletionLines, ...block.additionLines);
    }
  }

  return resolvedLines;
}

// Check that a hunk we did not resolve still points at the same logical lines
// as before. In other words, its updated addition/deletion indices must still
// lead back to the same source slices in the mutated diff arrays.
function assertUnresolvedHunkMatchesSnapshot(
  diff: FileDiffMetadata,
  hunkIndex: number,
  snapshot: HunkSnapshot
) {
  const hunk = diff.hunks[hunkIndex];
  expect(hunk).toBeDefined();
  expect(hunk?.hunkContent).toHaveLength(snapshot.blocks.length);

  if (hunk == null) {
    return;
  }

  for (const [contentIndex, expectedBlock] of snapshot.blocks.entries()) {
    const content = hunk.hunkContent[contentIndex];
    expect(content?.type).toBe(expectedBlock.type);

    if (content == null) {
      continue;
    }

    if (expectedBlock.type === 'context') {
      expect(content.type).toBe('context');
      if (content.type !== 'context') {
        continue;
      }

      expect(
        diff.deletionLines.slice(
          content.deletionLineIndex,
          content.deletionLineIndex + content.lines
        )
      ).toEqual(expectedBlock.lines);
      expect(
        diff.additionLines.slice(
          content.additionLineIndex,
          content.additionLineIndex + content.lines
        )
      ).toEqual(expectedBlock.lines);
      continue;
    }

    expect(content.type).toBe('change');
    if (content.type !== 'change') {
      continue;
    }

    expect(
      diff.deletionLines.slice(
        content.deletionLineIndex,
        content.deletionLineIndex + content.deletions
      )
    ).toEqual(expectedBlock.deletionLines);
    expect(
      diff.additionLines.slice(
        content.additionLineIndex,
        content.additionLineIndex + content.additions
      )
    ).toEqual(expectedBlock.additionLines);
  }
}

// Check the hunk that was actually resolved. Every block in the resolved region
// should now be context-only, and the hunk-level line ranges should point at
// the resolved sequence on both sides.
function assertResolvedHunkMatchesExpected(
  diff: FileDiffMetadata,
  hunkIndex: number,
  expectedLines: string[]
) {
  const hunk = diff.hunks[hunkIndex];
  expect(hunk).toBeDefined();

  if (hunk == null) {
    return;
  }

  expect(hunk.hunkContent.every((content) => content.type === 'context')).toBe(
    true
  );
  expect(
    hunk.hunkContent.reduce(
      (total, content) =>
        total + (content.type === 'context' ? content.lines : 0),
      0
    )
  ).toBe(expectedLines.length);
  expect(
    diff.deletionLines.slice(
      hunk.deletionLineIndex,
      hunk.deletionLineIndex + expectedLines.length
    )
  ).toEqual(expectedLines);
  expect(
    diff.additionLines.slice(
      hunk.additionLineIndex,
      hunk.additionLineIndex + expectedLines.length
    )
  ).toEqual(expectedLines);
  expect(hunk.additionLines).toBe(0);
  expect(hunk.deletionLines).toBe(0);
  expect(hunk.additionCount).toBe(expectedLines.length);
  expect(hunk.deletionCount).toBe(expectedLines.length);
}

describe('diffAcceptRejectHunk', () => {
  test('accept keeps later hunk indices accurate after resolving a pure-addition hunk', () => {
    const diff = createFixture();
    const resolvedSnapshot = snapshotHunk(diff, 0);
    const laterHunks = diff.hunks
      .slice(1)
      .map((_, index) => snapshotHunk(diff, index + 1));

    const result = diffAcceptRejectHunk(diff, 0, 'accept');

    assertResolvedHunkMatchesExpected(
      result,
      0,
      getResolvedLines(resolvedSnapshot, 'accept')
    );
    for (const [offset, snapshot] of laterHunks.entries()) {
      assertUnresolvedHunkMatchesSnapshot(result, offset + 1, snapshot);
    }
    expect(verifyFileDiffHunkValues(result)).toEqual({
      valid: true,
      errors: [],
    });
  });

  test('reject keeps later hunk indices accurate after resolving a pure-deletion hunk', () => {
    const diff = createFixture();
    const leadingHunk = snapshotHunk(diff, 0);
    const resolvedSnapshot = snapshotHunk(diff, 1);
    const trailingHunks = [snapshotHunk(diff, 2), snapshotHunk(diff, 3)];

    const result = diffAcceptRejectHunk(diff, 1, 'reject');

    assertUnresolvedHunkMatchesSnapshot(result, 0, leadingHunk);
    assertResolvedHunkMatchesExpected(
      result,
      1,
      getResolvedLines(resolvedSnapshot, 'reject')
    );
    assertUnresolvedHunkMatchesSnapshot(result, 2, trailingHunks[0]);
    assertUnresolvedHunkMatchesSnapshot(result, 3, trailingHunks[1]);
    expect(verifyFileDiffHunkValues(result)).toEqual({
      valid: true,
      errors: [],
    });
  });

  test('accept keeps later hunk indices accurate after resolving a replacement hunk', () => {
    const diff = createFixture();
    const earlierHunks = [snapshotHunk(diff, 0), snapshotHunk(diff, 1)];
    const resolvedSnapshot = snapshotHunk(diff, 2);
    const trailingHunk = snapshotHunk(diff, 3);

    const result = diffAcceptRejectHunk(diff, 2, 'accept');

    assertUnresolvedHunkMatchesSnapshot(result, 0, earlierHunks[0]);
    assertUnresolvedHunkMatchesSnapshot(result, 1, earlierHunks[1]);
    assertResolvedHunkMatchesExpected(
      result,
      2,
      getResolvedLines(resolvedSnapshot, 'accept')
    );
    assertUnresolvedHunkMatchesSnapshot(result, 3, trailingHunk);
    expect(verifyFileDiffHunkValues(result)).toEqual({
      valid: true,
      errors: [],
    });
  });

  test('reject keeps later hunk indices accurate after resolving a replacement hunk', () => {
    const diff = createFixture();
    const earlierHunks = [snapshotHunk(diff, 0), snapshotHunk(diff, 1)];
    const resolvedSnapshot = snapshotHunk(diff, 2);
    const trailingHunk = snapshotHunk(diff, 3);

    const result = diffAcceptRejectHunk(diff, 2, 'reject');

    assertUnresolvedHunkMatchesSnapshot(result, 0, earlierHunks[0]);
    assertUnresolvedHunkMatchesSnapshot(result, 1, earlierHunks[1]);
    assertResolvedHunkMatchesExpected(
      result,
      2,
      getResolvedLines(resolvedSnapshot, 'reject')
    );
    assertUnresolvedHunkMatchesSnapshot(result, 3, trailingHunk);
    expect(verifyFileDiffHunkValues(result)).toEqual({
      valid: true,
      errors: [],
    });
  });

  test('both should collapse the resolved mixed hunk to a correct context-only hunk', () => {
    const diff = createFixture();
    const earlierHunks = [
      snapshotHunk(diff, 0),
      snapshotHunk(diff, 1),
      snapshotHunk(diff, 2),
    ];
    const resolvedSnapshot = snapshotHunk(diff, 3);

    const result = diffAcceptRejectHunk(diff, 3, 'both');

    assertUnresolvedHunkMatchesSnapshot(result, 0, earlierHunks[0]);
    assertUnresolvedHunkMatchesSnapshot(result, 1, earlierHunks[1]);
    assertUnresolvedHunkMatchesSnapshot(result, 2, earlierHunks[2]);
    assertResolvedHunkMatchesExpected(
      result,
      3,
      getResolvedLines(resolvedSnapshot, 'both')
    );
    expect(verifyFileDiffHunkValues(result)).toEqual({
      valid: true,
      errors: [],
    });
  });

  test('both should keep later hunk indices accurate when an earlier hunk grows', () => {
    const diff = createFixture();
    const resolvedSnapshot = snapshotHunk(diff, 0);
    const laterHunks = diff.hunks
      .slice(1)
      .map((_, index) => snapshotHunk(diff, index + 1));

    const result = diffAcceptRejectHunk(diff, 0, 'both');

    assertResolvedHunkMatchesExpected(
      result,
      0,
      getResolvedLines(resolvedSnapshot, 'both')
    );
    for (const [offset, snapshot] of laterHunks.entries()) {
      assertUnresolvedHunkMatchesSnapshot(result, offset + 1, snapshot);
    }
    expect(verifyFileDiffHunkValues(result)).toEqual({
      valid: true,
      errors: [],
    });
  });

  test('updates cacheKey when both is used', () => {
    const diff = parseDiffFromFile(
      { name: 'example.ts', contents: 'old\n', cacheKey: 'old-key' },
      { name: 'example.ts', contents: 'new\n', cacheKey: 'new-key' }
    );

    const result = diffAcceptRejectHunk(diff, 0, 'both');

    expect(result.cacheKey).toBe('old-key:new-key:b-0:0-0');
  });

  test('accept resolves a partial patch without materializing omitted context', () => {
    const diff = createPartialFixture();
    const snapshot = snapshotHunk(diff, 0);

    const result = diffAcceptRejectHunk(diff, 0, 'accept');
    const [hunk] = result.hunks;

    expect(result.isPartial).toBe(true);
    expect(result.deletionLines).toEqual(getResolvedLines(snapshot, 'accept'));
    expect(result.additionLines).toEqual(getResolvedLines(snapshot, 'accept'));
    expect(hunk?.collapsedBefore).toBe(5);
    expect(hunk?.additionStart).toBe(6);
    expect(hunk?.deletionStart).toBe(6);
    expect(hunk?.additionLineIndex).toBe(0);
    expect(hunk?.deletionLineIndex).toBe(0);
    expect(result.splitLineCount).toBe(14);
    expect(result.unifiedLineCount).toBe(14);
    expect(verifyFileDiffHunkValues(result)).toEqual({
      valid: true,
      errors: [],
    });
  });

  test('updates cacheKey when resolving a single content block', () => {
    const diff = parseDiffFromFile(
      {
        name: 'example.ts',
        contents: [
          'line 01 stable',
          'line 02 add anchor',
          'line 03 stable',
          'line 04 stable',
          'line 05 stable',
          'line 06 delete me',
          'line 07 stable',
          'line 08 stable',
          'line 09 stable',
          'line 10 replace old',
          'line 11 stable',
          'line 12 stable',
          'line 13 stable',
          'line 14 mix old a',
          'line 15 mix shared',
          'line 16 mix old b',
          'line 17 stable',
          '',
        ].join('\n'),
        cacheKey: 'old-key',
      },
      {
        name: 'example.ts',
        contents: [
          'line 01 stable',
          'line 02 add anchor',
          'line 02.1 add first',
          'line 02.2 add second',
          'line 03 stable',
          'line 04 stable',
          'line 05 stable',
          'line 07 stable',
          'line 08 stable',
          'line 09 stable',
          'line 10 replace new',
          'line 11 stable',
          'line 12 stable',
          'line 13 stable',
          'line 14 mix new a',
          'line 15 mix shared',
          'line 16 mix new b',
          'line 17 stable',
          '',
        ].join('\n'),
        cacheKey: 'new-key',
      },
      { context: 1 }
    );

    const result = diffAcceptRejectHunk(diff, 2, {
      type: 'accept',
      changeIndex: 1,
    });

    expect(result.cacheKey).toBe('old-key:new-key:a-2:1-1');
  });

  test('both should inherit noEOFCR from additions', () => {
    const diff = parseDiffFromFile(
      { name: 'example.ts', contents: 'start\nold\n' },
      { name: 'example.ts', contents: 'start\nnew' }
    );
    const expectedLines = ['start\n', 'old\n', 'new'];

    const result = diffAcceptRejectHunk(diff, 0, 'both');
    const [hunk] = result.hunks;

    expect(hunk?.noEOFCRAdditions).toBe(true);
    expect(hunk?.noEOFCRDeletions).toBe(true);
    expect(result.deletionLines).toEqual(expectedLines);
    expect(result.additionLines).toEqual(expectedLines);
  });

  test('resolveConflict strips merge conflict separators from a resolved region', () => {
    const { fileDiff, actions } = parseMergeConflictDiffFromFile({
      name: 'conflict.ts',
      contents: [
        'before',
        '<<<<<<< HEAD',
        'const value = 1;',
        '||||||| base',
        'const value = 0;',
        '=======',
        'const value = 2;',
        '>>>>>>> branch',
        'after',
        '',
      ].join('\n'),
    });

    const result = resolveConflict(fileDiff, actions[0]!, 'incoming');

    expect(
      result.hunks[0]?.hunkContent.every(
        (content) => content.type === 'context'
      )
    ).toBe(true);
    expect(
      result.hunks[0]?.hunkContent.reduce(
        (total, content) =>
          total + (content.type === 'context' ? content.lines : 0),
        0
      )
    ).toBe(3);
    expect(result.deletionLines).toEqual([
      'before\n',
      'const value = 2;\n',
      'after\n',
    ]);
    expect(result.additionLines).toEqual([
      'before\n',
      'const value = 2;\n',
      'after\n',
    ]);
  });

  test('resolveConflict strips separators when a hunk contains multiple conflicts', () => {
    const { fileDiff, actions } = parseMergeConflictDiffFromFile({
      name: 'conflict.ts',
      contents: [
        'start',
        '<<<<<<< HEAD',
        'ours one',
        '=======',
        'theirs one',
        '>>>>>>> branch',
        'middle',
        '<<<<<<< HEAD',
        'ours two',
        '=======',
        'theirs two',
        '>>>>>>> branch',
        'end',
        '',
      ].join('\n'),
    });

    const result = resolveConflict(fileDiff, actions[0]!, 'current');

    expect(result.deletionLines).toEqual([
      'start\n',
      'ours one\n',
      'middle\n',
      'ours two\n',
      'end\n',
    ]);
    expect(result.additionLines).toEqual([
      'start\n',
      'ours one\n',
      'middle\n',
      'theirs two\n',
      'end\n',
    ]);
  });
});
