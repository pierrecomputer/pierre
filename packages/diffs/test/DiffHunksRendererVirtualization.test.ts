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
  collectRowSourceMismatches,
  countDeclaredRows,
  countRenderedLines,
  extractLineNumbers,
  projectColumn,
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
  const oldFileLines = fileOld.split('\n');
  const newFileLines = fileNew.split('\n');

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

  // Render-range semantics: startingLine/totalLines index the sequence of
  // renderable rows, NOT data-line-index values (which number the virtual
  // line space where collapsed gaps still occupy indices).
  //
  // Diff structure from fileOld/fileNew (regenerate with parseDiffFromFile if
  // the fixtures change):
  // - 14 hunks declaring 514 unified / 487 split rows. The single-line
  //   collapsed gaps before hunks 4, 6, and 10 (virtual unified indices 129,
  //   171, 442) auto-expand because they are at or under
  //   DEFAULT_COLLAPSED_CONTEXT_THRESHOLD, so full renders emit 517 unified
  //   and 490 split rows.
  // - Notable hunks (virtual unified indices / full-render row offsets):
  //   - Hunk 0: indices 3-11, rows 0-8 (9 lines), collapsedBefore: 3
  //   - Hunk 3: indices 107-128, rows 34-55 (22 lines), collapsedBefore: 50
  //     (collapsed region at indices 57-106)
  //   - Hunk 7: indices 244-373, rows 116-245 (130 lines) - LARGEST HUNK
  //   - Hunk 13: indices 718-753, rows 481-516 (36 lines) - FINAL HUNK

  describe('full render baselines', () => {
    test('1.1: Zero buffers - unified mode', async () => {
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

      // The renderer passes the requested buffer sizes through on the result;
      // buffer DOM elements are created by File/FileDiff, not the renderer.
      expect(result.bufferBefore).toBe(0);
      expect(result.bufferAfter).toBe(0);

      const lineCount = countRenderedLines(result.unifiedContentAST);
      // 514 hunk-declared rows + 3 auto-expanded single-line gaps
      expect(lineCount).toBe(517);
      expect(lineCount).toBe(countDeclaredRows(fileDiff, 'unified'));
    });

    test('1.2: Zero buffers - split mode', async () => {
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

      expect(result.bufferBefore).toBe(0);
      expect(result.bufferAfter).toBe(0);

      const additionLines = countRenderedLines(result.additionsContentAST);
      const deletionLines = countRenderedLines(result.deletionsContentAST);

      // Exact per-column row counts for the fixture: each column renders only
      // the rows its own side participates in (context plus its change rows)
      expect(deletionLines).toBe(267);
      expect(additionLines).toBe(431);
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
      // Hunk 0 has collapsedBefore: 3, so first index is 3
      expect(unifiedIndices[0]).toBe(3);
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
      // First rendered line index -- it's hard coded because it's a bit hard
      // to figure out, so mostly a good reference if tests change these
      // assumptions
      expect(unifiedIndices[0]).toBe(184);
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
      expect(splitAdditionLines).toBe(37);
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

      // Verify the specific expanded lines are present
      // Hunk 3 collapsed region is 57-106, expanding 20 from start should show 57-76
      const expandedLines = unifiedIndices.filter(
        (idx) => idx >= 57 && idx <= 76
      );
      expect(expandedLines.length).toBe(20);
      expect(expandedLines[0]).toBe(57);
      expect(expandedLines[19]).toBe(76);
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

      // Verify the specific expanded lines are present
      // Hunk 3 collapsed region is 57-106, expanding 15 from end should show 92-106
      const expandedLines = unifiedIndices.filter(
        (idx) => idx >= 92 && idx <= 106
      );
      expect(expandedLines.length).toBe(15);
      expect(expandedLines[0]).toBe(92);
      expect(expandedLines[14]).toBe(106);

      // Verify line indices are monotonically increasing
      for (let i = 1; i < unifiedIndices.length; i++) {
        expect(unifiedIndices[i]).toBeGreaterThanOrEqual(unifiedIndices[i - 1]);
      }
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

      // Verify the specific expanded lines are present
      // Hunk 3 collapsed region is 57-106
      // Expanding 10 from start should show 57-66
      // Expanding 10 from end should show 97-106
      const expandedFromStart = unifiedIndices.filter(
        (idx) => idx >= 57 && idx <= 66
      );
      const expandedFromEnd = unifiedIndices.filter(
        (idx) => idx >= 97 && idx <= 106
      );
      expect(expandedFromStart.length).toBe(10);
      expect(expandedFromStart[0]).toBe(57);
      expect(expandedFromStart[9]).toBe(66);
      expect(expandedFromEnd.length).toBe(10);
      expect(expandedFromEnd[0]).toBe(97);
      expect(expandedFromEnd[9]).toBe(106);
    });

    test('3.5: Windowing with expanded regions (tests a9ff17b7 fix)', async () => {
      // Hunk 3 occupies rows 34-55 (indices 107-128) with collapsedBefore: 50
      // (collapsed indices 57-106). Expanding 20 from start makes indices
      // 57-76 renderable. A window starting at row 30 must NOT skip the
      // expanded hunk — the a9ff17b7 bug did exactly that.
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

      const windowedIndices = extractLineNumbers(
        result.unifiedContentAST
      ).unifiedIndices;

      // Differential oracle: the windowed render must emit exactly rows
      // 30..79 of the full render with the same expansion state
      const fullResult = await expandedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      assertDefined(
        fullResult.unifiedContentAST,
        'fullResult.unifiedContentAST should be defined'
      );
      const fullIndices = extractLineNumbers(
        fullResult.unifiedContentAST
      ).unifiedIndices;

      expect(windowedIndices).toHaveLength(50);
      expect(windowedIndices).toEqual(fullIndices.slice(30, 80));
      // The 20 expanded lines (indices 57-76) fall inside this window. This
      // containment check catches the regression even if a full render were
      // to skip the expanded hunk the same way.
      expect(
        windowedIndices.filter((idx) => idx >= 57 && idx <= 76)
      ).toHaveLength(20);
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
        (idx) => idx >= 57 && idx <= 106
      );
      expect(fullyExpandedRange).toHaveLength(50);
      expect(fullyExpandedRange[0]).toBe(57);
      expect(fullyExpandedRange[49]).toBe(106);
      // Separator rows are not counted by countRenderedLines (no data-line),
      // so expanding this 50-line collapsed range adds exactly 50 line rows.
      expect(lineCount).toBe(unexpandedLineCount + 50);
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
      // Hunk 0 occupies rows 0-8 (indices 3-11 due to collapsedBefore: 3);
      // a 9-row window renders exactly hunk 0
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
      // Hunk 1 starts at row offset 9 (hunk 0 occupies rows 0-8)
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
      // The full render emits 517 rows, so a window starting at 1000 is
      // entirely past the content
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 1000,
        totalLines: 20,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      // The renderer returns no AST when there is nothing to render
      expect(result.unifiedContentAST).toBeUndefined();
    });

    test('4.5: Partial hunk - window starts mid-hunk', async () => {
      // Hunk 7: rows 116-245 (130 lines) - our largest hunk
      // Start window at row 150, partway through
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
      // Hunk 7: rows 116-245 (130 lines)
      // Start at row 114, but only render 50 lines
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
      // Hunks 0-2 cover rows 0-33 (indices 3-56)
      // Start window at row 100, should skip first 3 hunks entirely
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
      // Hunks 0-2 only contain indices 3-56, none of which may appear
      expect(unifiedIndices.every((idx) => idx > 56)).toBe(true);
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
      // Should have 34 lines total, ending at hunk 2's last index
      expect(unifiedIndices.length).toBe(34);
      expect(unifiedIndices.at(-1)).toBe(56);
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

      const rows = projectColumn(result.unifiedContentAST).filter(
        (row) => row.kind === 'line'
      );
      expect(rows).toHaveLength(10);

      // The window must be exactly rows 10-19 of the full render
      const fullResult = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      assertDefined(
        fullResult.unifiedContentAST,
        'fullResult.unifiedContentAST should be defined'
      );
      const fullRows = projectColumn(fullResult.unifiedContentAST).filter(
        (row) => row.kind === 'line'
      );
      expect(rows).toEqual(fullRows.slice(10, 20));

      // Every rendered row carries the exact text of its source line
      expect(
        collectRowSourceMismatches(rows, 'unified', oldFileLines, newFileLines)
      ).toEqual([]);
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

      const additionRows = projectColumn(result.additionsContentAST).filter(
        (row) => row.kind === 'line'
      );
      const deletionRows = projectColumn(result.deletionsContentAST).filter(
        (row) => row.kind === 'line'
      );

      // The window covers split row positions 10-19 of the full render; each
      // column must contain exactly its rows at those positions
      const fullResult = await splitRenderer.asyncRender(fileDiff, {
        startingLine: 0,
        totalLines: Infinity,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      assertDefined(
        fullResult.additionsContentAST,
        'fullResult.additionsContentAST should be defined'
      );
      assertDefined(
        fullResult.deletionsContentAST,
        'fullResult.deletionsContentAST should be defined'
      );
      const fullAdditionRows = projectColumn(
        fullResult.additionsContentAST
      ).filter((row) => row.kind === 'line');
      const fullDeletionRows = projectColumn(
        fullResult.deletionsContentAST
      ).filter((row) => row.kind === 'line');
      const splitPositions = [
        ...new Set(
          [...fullAdditionRows, ...fullDeletionRows].map(
            (row) => row.splitIndex
          )
        ),
      ].sort((a, b) => (a ?? 0) - (b ?? 0));
      const windowPositions = new Set(splitPositions.slice(10, 20));

      expect(additionRows).toEqual(
        fullAdditionRows.filter((row) => windowPositions.has(row.splitIndex))
      );
      expect(deletionRows).toEqual(
        fullDeletionRows.filter((row) => windowPositions.has(row.splitIndex))
      );

      // Each column carries the exact text of its own side's source lines
      expect(
        collectRowSourceMismatches(
          additionRows,
          'additions',
          oldFileLines,
          newFileLines
        )
      ).toEqual([]);
      expect(
        collectRowSourceMismatches(
          deletionRows,
          'deletions',
          oldFileLines,
          newFileLines
        )
      ).toEqual([]);
    });
  });

  describe('final hunk handling', () => {
    test('7.1: Final hunk with early break', async () => {
      // Hunk 13 (final) occupies rows 481-516; a window ending mid-final-hunk
      // must render without throwing (tests 1ea14dbf fix)
      const result = await unifiedRenderer.asyncRender(fileDiff, {
        startingLine: 478,
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
    });
  });
});
