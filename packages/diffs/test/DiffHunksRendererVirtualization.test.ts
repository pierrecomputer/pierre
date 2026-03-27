import { afterAll, describe, expect, test } from 'bun:test';
import type { ElementContent } from 'hast';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  parseDiffFromFile,
} from '../src';
import { fileNew, fileOld } from './mocks';
import {
  assertDefined,
  collectAllElements,
  countRenderedLines,
  extractLineNumbers,
  findBufferElements,
} from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

describe('DiffHunksRenderer - Virtualization', () => {
  // Shared instances across tests for efficiency
  const fileDiff = parseDiffFromFile(
    { name: 'test.txt', contents: fileOld },
    { name: 'test.txt', contents: fileNew }
  );

  const unifiedRenderer = new DiffHunksRenderer({
    diffStyle: 'unified',
  });

  const splitRenderer = new DiffHunksRenderer({
    diffStyle: 'split',
  });

  function countNoNewlineElements(ast: ElementContent[]): number {
    return collectAllElements(ast).filter(
      (node) => 'data-no-newline' in node.properties
    ).length;
  }

  function getTopLevelNodeKinds(ast: ElementContent[]): string[] {
    return ast.map((node) => {
      if (node.type !== 'element') {
        return 'other';
      }
      if ('data-content-buffer' in node.properties) {
        return 'buffer';
      }
      if ('data-no-newline' in node.properties) {
        return 'no-newline';
      }
      if (node.properties['data-line'] != null) {
        return 'line';
      }
      return 'other';
    });
  }

  const totalUnifiedRows = fileDiff.hunks.reduce(
    (sum, hunk) => sum + hunk.unifiedLineCount,
    0
  );
  const totalSplitAdditionRows = fileDiff.hunks.reduce(
    (sum, hunk) => sum + hunk.additionCount,
    0
  );
  const totalSplitDeletionRows = fileDiff.hunks.reduce(
    (sum, hunk) => sum + hunk.deletionCount,
    0
  );
  const finalHunkVisibleStart = fileDiff.hunks
    .slice(0, -1)
    .reduce((sum, hunk) => sum + hunk.unifiedLineCount, 0);

  // Diff structure from fileOld/fileNew:
  // - 14 hunks total
  // - Total unified lines: 514
  // - Total split lines: 487
  // - Notable hunks for testing:
  //   - Hunk 0: unified 0-8 (9 lines), split 0-8 (9 lines), collapsedBefore: 3
  //   - Hunk 3: unified 34-55 (22 lines), split 34-52 (19 lines), collapsedBefore: 50
  //   - Hunk 7: unified 114-243 (130 lines), split 108-237 (130 lines), collapsedBefore: 44 - LARGEST HUNK
  //   - Hunk 11: unified 315-450 (136 lines), split 301-423 (123 lines), collapsedBefore: 5
  //   - Hunk 13: unified 478-513 (36 lines), split 451-486 (36 lines), collapsedBefore: 56 - FINAL HUNK

  describe('buffer rendering', () => {
    test('1.1: No buffers (baseline) - unified mode', async () => {
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const buffers = findBufferElements(result.unifiedContentAST);
      expect(buffers).toHaveLength(0);

      const lineCount = countRenderedLines(result.unifiedContentAST);
      // Total unified lines that are rendered
      expect(lineCount).toBe(totalUnifiedRows);
    });

    test('1.2: No buffers (baseline) - split mode', async () => {
      const result = await splitRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.additionsContentAST,
        'additionsContentAST should be defined'
      );
      assertDefined(
        result.deletionsContentAST,
        'deletionsContentAST should be defined'
      );

      const additionBuffers = findBufferElements(result.additionsContentAST);
      const deletionBuffers = findBufferElements(result.deletionsContentAST);

      expect(additionBuffers).toHaveLength(0);
      expect(deletionBuffers).toHaveLength(0);

      const additionLines = countRenderedLines(result.additionsContentAST);
      const deletionLines = countRenderedLines(result.deletionsContentAST);

      // These are somewhat arbitrary because there's lots of stuff collapsed
      // between change hunks
      expect(deletionLines).toBe(totalSplitDeletionRows);
      expect(additionLines).toBe(totalSplitAdditionRows);
    });
  });

  describe('no-newline metadata', () => {
    test('renders deletion-side metadata when deletions are shorter in split mode', async () => {
      const fileDiff = parseDiffFromFile(
        { name: 'deletion-shorter.txt', contents: 'same\nold-final' },
        { name: 'deletion-shorter.txt', contents: 'same\nnew-a\nnew-b\n' }
      );
      const result = await new DiffHunksRenderer({
        diffStyle: 'split',
      }).asyncRender(fileDiff);

      assertDefined(
        result.deletionsContentAST,
        'deletionsContentAST should be defined'
      );
      assertDefined(
        result.additionsContentAST,
        'additionsContentAST should be defined'
      );
      expect(countNoNewlineElements(result.deletionsContentAST)).toBe(1);
      expect(countNoNewlineElements(result.additionsContentAST)).toBe(0);
      expect(
        getTopLevelNodeKinds(result.deletionsContentAST).slice(-2)
      ).toEqual(['buffer', 'no-newline']);
      expect(
        getTopLevelNodeKinds(result.additionsContentAST).slice(-1)
      ).toEqual(['buffer']);
    });

    test('renders addition-side metadata when additions are shorter in split mode', async () => {
      const fileDiff = parseDiffFromFile(
        { name: 'addition-shorter.txt', contents: 'same\nold-a\nold-b\n' },
        { name: 'addition-shorter.txt', contents: 'same\nnew-final' }
      );
      const result = await new DiffHunksRenderer({
        diffStyle: 'split',
      }).asyncRender(fileDiff);

      assertDefined(
        result.deletionsContentAST,
        'deletionsContentAST should be defined'
      );
      assertDefined(
        result.additionsContentAST,
        'additionsContentAST should be defined'
      );
      expect(countNoNewlineElements(result.deletionsContentAST)).toBe(0);
      expect(countNoNewlineElements(result.additionsContentAST)).toBe(1);
      expect(
        getTopLevelNodeKinds(result.deletionsContentAST).slice(-1)
      ).toEqual(['buffer']);
      expect(
        getTopLevelNodeKinds(result.additionsContentAST).slice(-2)
      ).toEqual(['buffer', 'no-newline']);
    });
  });

  describe('line count math', () => {
    test('2.1: No windowing - full render', async () => {
      const unifiedResult = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      const splitResult = await splitRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        unifiedResult.unifiedContentAST,
        'unifiedContentAST should be defined'
      );
      assertDefined(
        splitResult.additionsContentAST,
        'additionsContentAST should be defined'
      );
      assertDefined(
        splitResult.deletionsContentAST,
        'deletionsContentAST should be defined'
      );

      const unifiedLines = countRenderedLines(unifiedResult.unifiedContentAST);
      expect(unifiedLines).toBe(totalUnifiedRows);

      // In split mode, total lines across both columns
      const splitAdditionLines = countRenderedLines(
        splitResult.additionsContentAST
      );
      const splitDeletionLines = countRenderedLines(
        splitResult.deletionsContentAST
      );

      // Verify against expected totals
      expect(splitAdditionLines + splitDeletionLines).toBeGreaterThan(0);
    });

    test('2.2: Basic window - first N lines', async () => {
      // Render first 30 lines
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: 30,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const lineCount = countRenderedLines(result.unifiedContentAST);
      expect(lineCount).toBeLessThanOrEqual(30);

      const { unifiedIndices } = extractLineNumbers(result.unifiedContentAST);
      expect(unifiedIndices[0]).toBe(fileDiff.hunks[0]?.unifiedLineStart);
      expect(unifiedIndices.length).toBe(30);
    });

    test('2.3: Basic window - middle lines', async () => {
      // Render lines 100-150 (50 lines)
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 100,
        totalLines: 50,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const lineCount = countRenderedLines(result.unifiedContentAST);
      expect(lineCount).toBeLessThanOrEqual(50);

      const { unifiedIndices } = extractLineNumbers(result.unifiedContentAST);
      // Line indices might not be continuous due to collapsed regions
      // But we should have rendered exactly 50 lines
      expect(unifiedIndices.length).toBe(50);
      expect(unifiedIndices[0]).toBeGreaterThanOrEqual(100);
    });

    test('2.4: Split vs Unified line counting', async () => {
      // Use same window for both modes
      const renderRange = {
        startingLine: 50,
        totalLines: 50,
        bufferBefore: 0,
        bufferAfter: 0,
      };

      const unifiedResult = await unifiedRenderer.asyncRender(
        fileDiff,
        renderRange
      );
      const splitResult = await splitRenderer.asyncRender(
        fileDiff,
        renderRange
      );

      assertDefined(
        unifiedResult.unifiedContentAST,
        'unifiedContentAST should be defined'
      );
      assertDefined(
        splitResult.additionsContentAST,
        'additionsContentAST should be defined'
      );
      assertDefined(
        splitResult.deletionsContentAST,
        'deletionsContentAST should be defined'
      );

      const unifiedLines = countRenderedLines(unifiedResult.unifiedContentAST);
      const splitAdditionLines = countRenderedLines(
        splitResult.additionsContentAST
      );
      const splitDeletionLines = countRenderedLines(
        splitResult.deletionsContentAST
      );

      expect(unifiedLines).toBe(50);
      expect(splitAdditionLines).toBeGreaterThan(0);
      expect(splitAdditionLines).toBeLessThanOrEqual(50);
      expect(splitDeletionLines).toBe(50);
    });
  });

  describe('expanded collapsed regions', () => {
    test('3.1: Fully expanded - expandUnchanged = true', async () => {
      const expandedRenderer = new DiffHunksRenderer({
        diffStyle: 'unified',
        expandUnchanged: true,
      });

      const result = await expandedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const lineCount = countRenderedLines(result.unifiedContentAST);

      // With expandUnchanged, all collapsed lines are rendered
      // Total should be significantly more than 514
      expect(lineCount).toBe(fileDiff.unifiedLineCount);
    });

    test('3.2: Partially expanded - fromStart only', async () => {
      // Use Hunk 3 which has collapsedBefore: 50, unifiedLineStart: 107
      // Expand 20 lines from start using expandHunk method
      const expandedRenderer = new DiffHunksRenderer({
        diffStyle: 'unified',
        expansionLineCount: 20,
      });

      // Expand hunk 3, from start
      expandedRenderer.expandHunk(3, 'up');

      const result = await expandedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const { unifiedIndices } = extractLineNumbers(result.unifiedContentAST);

      // Should have 20 more lines than unexpanded
      const unexpandedResult = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        unexpandedResult.unifiedContentAST,
        'unexpandedResult.unifiedContentAST should be defined'
      );
      const unexpandedLineCount = countRenderedLines(
        unexpandedResult.unifiedContentAST
      );

      expect(unifiedIndices.length).toBe(unexpandedLineCount + 20);

      const unexpandedIndices = new Set(
        extractLineNumbers(unexpandedResult.unifiedContentAST).unifiedIndices
      );
      const expandedOnlyLines = unifiedIndices.filter(
        (idx) => !unexpandedIndices.has(idx)
      );
      expect(expandedOnlyLines).toHaveLength(20);
      expect(expandedOnlyLines[0]).toBe(56);
      expect(expandedOnlyLines[19]).toBe(75);
      expect(result).toMatchSnapshot('expansion fromStart 20 lines');
    });

    test('3.3: Partially expanded - fromEnd only', async () => {
      // Use Hunk 3 which has collapsedBefore: 50, unifiedLineStart: 107
      // Expand 15 lines from end using expandHunk method
      const expandedRenderer = new DiffHunksRenderer({
        diffStyle: 'unified',
        expansionLineCount: 15,
      });

      // Expand hunk 3, from end (down direction)
      expandedRenderer.expandHunk(3, 'down');

      const result = await expandedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const { unifiedIndices } = extractLineNumbers(result.unifiedContentAST);

      // Should have 15 more lines than unexpanded
      const unexpandedResult = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        unexpandedResult.unifiedContentAST,
        'unexpandedResult.unifiedContentAST should be defined'
      );
      const unexpandedLineCount = countRenderedLines(
        unexpandedResult.unifiedContentAST
      );

      expect(unifiedIndices.length).toBe(unexpandedLineCount + 15);

      const unexpandedIndices = new Set(
        extractLineNumbers(unexpandedResult.unifiedContentAST).unifiedIndices
      );
      const expandedOnlyLines = unifiedIndices.filter(
        (idx) => !unexpandedIndices.has(idx)
      );
      expect(expandedOnlyLines).toHaveLength(15);
      expect(expandedOnlyLines[0]).toBe(93);
      expect(expandedOnlyLines[14]).toBe(107);

      // Verify line indices are monotonically increasing
      for (let i = 1; i < unifiedIndices.length; i++) {
        expect(unifiedIndices[i]).toBeGreaterThanOrEqual(unifiedIndices[i - 1]);
      }
      expect(result).toMatchSnapshot('expansion fromEnd 15 lines');
    });

    test('3.4: Partially expanded - both fromStart and fromEnd', async () => {
      // Use Hunk 3 which has collapsedBefore: 50, unifiedLineStart: 107
      // Expand 10 from start, 10 from end
      const expandedRenderer = new DiffHunksRenderer({
        diffStyle: 'unified',
        expansionLineCount: 10,
      });

      // Expand hunk 3, both directions
      expandedRenderer.expandHunk(3, 'both');

      const result = await expandedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const { unifiedIndices } = extractLineNumbers(result.unifiedContentAST);

      // Should have 20 more lines than unexpanded (10 from start + 10 from end)
      const unexpandedResult = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        unexpandedResult.unifiedContentAST,
        'unexpandedResult.unifiedContentAST should be defined'
      );
      const unexpandedLineCount = countRenderedLines(
        unexpandedResult.unifiedContentAST
      );

      expect(unifiedIndices.length).toBe(unexpandedLineCount + 20);

      const unexpandedIndices = new Set(
        extractLineNumbers(unexpandedResult.unifiedContentAST).unifiedIndices
      );
      const expandedOnlyLines = unifiedIndices.filter(
        (idx) => !unexpandedIndices.has(idx)
      );
      expect(expandedOnlyLines).toEqual([
        56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 98, 99, 100, 101, 102, 103, 104,
        105, 106, 107,
      ]);
      expect(result).toMatchSnapshot('expansion both directions 10 lines each');
    });

    test('3.5: Windowing with expanded regions (tests a9ff17b7 fix)', async () => {
      // This is the critical test for the bug fix
      // Hunk 3 has collapsedBefore: 50, unified range: 34-55
      // Expand 20 from start, so total is hunk.unifiedLineCount (22) + 20 = 42
      // Window starts at line 30, should NOT skip this hunk
      const expandedRenderer = new DiffHunksRenderer({
        diffStyle: 'unified',
        expansionLineCount: 20,
      });

      // Expand hunk 3 from start
      expandedRenderer.expandHunk(3, 'up');

      const result = await expandedRenderer.asyncRender(fileDiff, {
        startingLine: 30,
        totalLines: 50,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const lineCount = countRenderedLines(result.unifiedContentAST);

      // Should have rendered content (not skipped)
      expect(lineCount).toBeGreaterThan(0);
      expect(lineCount).toBeLessThanOrEqual(50);
      expect(result).toMatchSnapshot('expansion with windowing');
    });

    test('3.6: Fully expanded single hunk range', async () => {
      const expandedRenderer = new DiffHunksRenderer({
        diffStyle: 'unified',
      });

      expandedRenderer.expandHunk(3, 'both', Number.POSITIVE_INFINITY);

      const result = await expandedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'result.unifiedContentAST should be defined'
      );

      const { unifiedIndices } = extractLineNumbers(result.unifiedContentAST);
      const lineCount = countRenderedLines(result.unifiedContentAST);

      const unexpandedResult = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      assertDefined(
        unexpandedResult.unifiedContentAST,
        'unexpandedResult.unifiedContentAST should be defined'
      );
      const unexpandedLineCount = countRenderedLines(
        unexpandedResult.unifiedContentAST
      );

      const fullyExpandedRange = unifiedIndices.filter(
        (idx) => idx >= 56 && idx <= 107
      );
      expect(fullyExpandedRange).toHaveLength(52);
      expect(fullyExpandedRange[0]).toBe(56);
      expect(fullyExpandedRange[51]).toBe(107);
      // Separator rows are not counted by countRenderedLines (no data-line),
      // so expanding this collapsed range adds exactly its visible line rows.
      expect(lineCount).toBe(unexpandedLineCount + 52);
      // Verify we only expanded this hunk range, not the entire file.
      // Hunk 0 still has collapsed leading lines (0..2), so they should
      // remain hidden.
      expect(unifiedIndices).not.toContain(0);
      expect(unifiedIndices).not.toContain(1);
      expect(unifiedIndices).not.toContain(2);
    });
  });

  describe('window boundary edge cases', () => {
    test('4.1: Window ends at exact hunk boundary', async () => {
      // Hunk 0: unified 0-8 (9 lines), but starts at index 3 due to collapsedBefore: 3
      // Window of 9 lines should render exactly hunk 0
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: 9,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const lineCount = countRenderedLines(result.unifiedContentAST);
      expect(lineCount).toBe(9);
    });

    test('4.2: Window starts at exact hunk boundary', async () => {
      // Hunk 1 starts at unified line 9
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 9,
        totalLines: 20,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const lineCount = countRenderedLines(result.unifiedContentAST);
      expect(lineCount).toBeGreaterThan(0);
      expect(lineCount).toBeLessThanOrEqual(20);

      const { unifiedIndices } = extractLineNumbers(result.unifiedContentAST);
      // First line should be >= 9 (accounting for any collapsed lines)
      expect(unifiedIndices[0]).toBeGreaterThanOrEqual(9);
    });

    test('4.3: Single line window', async () => {
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 50,
        totalLines: 1,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const lineCount = countRenderedLines(result.unifiedContentAST);
      expect(lineCount).toBe(1);

      const { unifiedIndices } = extractLineNumbers(result.unifiedContentAST);
      expect(unifiedIndices.length).toBe(1);
      expect(unifiedIndices[0]).toBeGreaterThanOrEqual(50);
    });

    test('4.4: Window entirely past content', async () => {
      // Total unified lines is 514, so start at 1000
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 1000,
        totalLines: 20,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      // When window is entirely past content, AST may be undefined
      if (result.unifiedContentAST != null) {
        const lineCount = countRenderedLines(result.unifiedContentAST);
        expect(lineCount).toBe(0);
      } else {
        // AST is undefined when no lines to render
        expect(result.unifiedContentAST).toBeUndefined();
      }
    });

    test('4.5: Partial hunk - window starts mid-hunk', async () => {
      // Hunk 7: unified 114-243 (130 lines) - our largest hunk
      // Start window at 150, halfway through
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 150,
        totalLines: 50,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const lineCount = countRenderedLines(result.unifiedContentAST);
      expect(lineCount).toBeGreaterThan(0);
      expect(lineCount).toBeLessThanOrEqual(50);

      const { unifiedIndices } = extractLineNumbers(result.unifiedContentAST);
      // Should start around 150
      expect(unifiedIndices[0]).toBeGreaterThanOrEqual(150);
    });

    test('4.6: Partial hunk - window ends mid-hunk', async () => {
      // Hunk 7: unified 114-243 (130 lines)
      // Start at 114, but only render 50 lines
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 114,
        totalLines: 50,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const lineCount = countRenderedLines(result.unifiedContentAST);
      expect(lineCount).toBe(50);

      const { unifiedIndices } = extractLineNumbers(result.unifiedContentAST);
      // First rendered line should be >= 114
      expect(unifiedIndices[0]).toBeGreaterThanOrEqual(114);
    });
  });

  describe('multiple hunks in window', () => {
    test('5.1: Skip entire hunks before window', async () => {
      // Hunks 0-2 cover unified lines 0-33
      // Start window at 100, should skip first 3 hunks entirely
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 100,
        totalLines: 50,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const lineCount = countRenderedLines(result.unifiedContentAST);
      expect(lineCount).toBeGreaterThan(0);

      const { unifiedIndices } = extractLineNumbers(result.unifiedContentAST);
      // Should not include any lines from first 3 hunks (< 34)
      expect(unifiedIndices.every((idx) => idx >= 34)).toBe(true);
    });

    test('5.2: Window spans multiple hunks', async () => {
      // Hunks 0-2: unified 0-33
      // Window that includes all of them
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: 34,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const lineCount = countRenderedLines(result.unifiedContentAST);
      expect(lineCount).toBe(34);

      const { unifiedIndices } = extractLineNumbers(result.unifiedContentAST);
      // Should have 34 lines total
      expect(unifiedIndices.length).toBe(34);
    });

    test('5.3: Window includes partial hunks at boundaries', async () => {
      // Window from 5 to 30 (25 lines)
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 5,
        totalLines: 25,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const lineCount = countRenderedLines(result.unifiedContentAST);
      expect(lineCount).toBe(25);

      const { unifiedIndices } = extractLineNumbers(result.unifiedContentAST);
      // Should have 25 lines
      expect(unifiedIndices.length).toBe(25);
    });
  });

  describe('correct lines rendered', () => {
    test('6.1: Rendered content matches source - unified', async () => {
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 10,
        totalLines: 10,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const lineCount = countRenderedLines(result.unifiedContentAST);
      expect(lineCount).toBe(10);

      // Verify we got exactly 10 lines
      const { unifiedIndices } = extractLineNumbers(result.unifiedContentAST);
      expect(unifiedIndices.length).toBe(10);

      // Snapshot test to verify content structure
      expect(result).toMatchSnapshot('unified window 10-20');
    });

    test('6.2: Rendered content matches source - split', async () => {
      const result = await splitRenderer.asyncRender(fileDiff, {
        startingLine: 10,
        totalLines: 10,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.additionsContentAST,
        'additionsContentAST should be defined'
      );
      assertDefined(
        result.deletionsContentAST,
        'deletionsContentAST should be defined'
      );

      const additionLines = countRenderedLines(result.additionsContentAST);
      const deletionLines = countRenderedLines(result.deletionsContentAST);

      expect(additionLines + deletionLines).toBeGreaterThan(0);

      // Verify total lines rendered
      const { splitIndices: additionIndices } = extractLineNumbers(
        result.additionsContentAST
      );
      const { splitIndices: deletionIndices } = extractLineNumbers(
        result.deletionsContentAST
      );

      expect(additionIndices.length + deletionIndices.length).toBeGreaterThan(
        0
      );

      // Snapshot test
      expect(result).toMatchSnapshot('split window 10-20');
    });
  });

  describe('final hunk handling', () => {
    test('7.1: Final hunk with early break', async () => {
      // Start at the visible-row offset where the final hunk begins so we
      // exercise the end-of-file early-break path.
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: finalHunkVisibleStart,
        totalLines: 20,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const lineCount = countRenderedLines(result.unifiedContentAST);
      expect(lineCount).toBe(20);

      // No errors should occur (tests 1ea14dbf fix)
      expect(result).toBeDefined();
    });

    test('7.2: Final hunk fully in window', async () => {
      // Render entire diff to ensure final hunk is fully rendered
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        result.unifiedContentAST,
        'unifiedContentAST should be defined'
      );

      const fullCount = countRenderedLines(result.unifiedContentAST);
      expect(fullCount).toBe(totalUnifiedRows);

      // Compare to partial render
      const partialResult = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: finalHunkVisibleStart,
        totalLines: 20,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      assertDefined(
        partialResult.unifiedContentAST,
        'partialResult.unifiedContentAST should be defined'
      );

      const partialCount = countRenderedLines(partialResult.unifiedContentAST);

      // Full render should have more lines
      expect(fullCount).toBeGreaterThan(partialCount);
    });
  });
});
