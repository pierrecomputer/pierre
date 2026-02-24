import { describe, expect, test } from 'bun:test';

import { DiffHunksRenderer, parseDiffFromFile } from '../src';
import { fileNew, fileOld } from './mocks';
import { assertDefined, countRenderedLines } from './testUtils';

describe('DiffHunksRenderer - expandAll / collapseAll', () => {
  const fileDiff = parseDiffFromFile(
    { name: 'test.txt', contents: fileOld },
    { name: 'test.txt', contents: fileNew }
  );

  const fullRenderRange = {
    startingLine: 0,
    totalLines: Infinity,
    bufferBefore: 0,
    bufferAfter: 0,
  };

  describe('expandAll', () => {
    test('expands all collapsed sections', async () => {
      const renderer = new DiffHunksRenderer({ diffStyle: 'unified' });

      // Render collapsed first
      const collapsedResult = await renderer.asyncRender(
        fileDiff,
        fullRenderRange
      );
      assertDefined(
        collapsedResult.unifiedContentAST,
        'collapsed unifiedContentAST'
      );
      const collapsedLineCount = countRenderedLines(
        collapsedResult.unifiedContentAST
      );

      // Now expand all
      renderer.expandAll();
      expect(renderer.isAllExpanded()).toBe(true);

      const expandedResult = await renderer.asyncRender(
        fileDiff,
        fullRenderRange
      );
      assertDefined(
        expandedResult.unifiedContentAST,
        'expanded unifiedContentAST'
      );
      const expandedLineCount = countRenderedLines(
        expandedResult.unifiedContentAST
      );

      expect(expandedLineCount).toBeGreaterThan(collapsedLineCount);
      expect(expandedLineCount).toBe(fileDiff.unifiedLineCount);
    });

    test('produces same result as expandUnchanged option', async () => {
      const imperativeRenderer = new DiffHunksRenderer({
        diffStyle: 'unified',
      });
      imperativeRenderer.expandAll();

      const declarativeRenderer = new DiffHunksRenderer({
        diffStyle: 'unified',
        expandUnchanged: true,
      });

      const imperativeResult = await imperativeRenderer.asyncRender(
        fileDiff,
        fullRenderRange
      );
      const declarativeResult = await declarativeRenderer.asyncRender(
        fileDiff,
        fullRenderRange
      );

      assertDefined(
        imperativeResult.unifiedContentAST,
        'imperative unifiedContentAST'
      );
      assertDefined(
        declarativeResult.unifiedContentAST,
        'declarative unifiedContentAST'
      );

      expect(countRenderedLines(imperativeResult.unifiedContentAST)).toBe(
        countRenderedLines(declarativeResult.unifiedContentAST)
      );
    });

    test('works in split mode', async () => {
      const renderer = new DiffHunksRenderer({ diffStyle: 'split' });

      const collapsedResult = await renderer.asyncRender(
        fileDiff,
        fullRenderRange
      );
      assertDefined(
        collapsedResult.additionsContentAST,
        'collapsed additionsContentAST'
      );
      const collapsedLineCount = countRenderedLines(
        collapsedResult.additionsContentAST
      );

      renderer.expandAll();

      const expandedResult = await renderer.asyncRender(
        fileDiff,
        fullRenderRange
      );
      assertDefined(
        expandedResult.additionsContentAST,
        'expanded additionsContentAST'
      );
      const expandedLineCount = countRenderedLines(
        expandedResult.additionsContentAST
      );

      expect(expandedLineCount).toBeGreaterThan(collapsedLineCount);
    });
  });

  describe('collapseAll', () => {
    test('resets allExpanded flag and clears expandedHunks map', () => {
      const renderer = new DiffHunksRenderer({ diffStyle: 'unified' });

      renderer.expandHunk(0, 'both');
      renderer.expandHunk(3, 'up');
      renderer.expandAll();

      expect(renderer.isAllExpanded()).toBe(true);

      renderer.collapseAll();

      expect(renderer.isAllExpanded()).toBe(false);
      expect(renderer.getExpandedHunksMap().size).toBe(0);
    });

    test('clears individual hunk expansions', async () => {
      const renderer = new DiffHunksRenderer({
        diffStyle: 'unified',
        expansionLineCount: 20,
      });

      // Get baseline
      const baselineResult = await renderer.asyncRender(
        fileDiff,
        fullRenderRange
      );
      assertDefined(
        baselineResult.unifiedContentAST,
        'baseline unifiedContentAST'
      );
      const baselineCount = countRenderedLines(
        baselineResult.unifiedContentAST
      );

      // Expand some hunks
      renderer.expandHunk(3, 'up');
      renderer.expandHunk(7, 'both');

      // Collapse all
      renderer.collapseAll();

      const afterCollapseResult = await renderer.asyncRender(
        fileDiff,
        fullRenderRange
      );
      assertDefined(
        afterCollapseResult.unifiedContentAST,
        'afterCollapse unifiedContentAST'
      );
      const afterCollapseCount = countRenderedLines(
        afterCollapseResult.unifiedContentAST
      );

      expect(afterCollapseCount).toBe(baselineCount);
    });
  });

  describe('round-trip', () => {
    test('expandAll then collapseAll returns to initial state', async () => {
      const renderer = new DiffHunksRenderer({ diffStyle: 'unified' });

      const initialResult = await renderer.asyncRender(
        fileDiff,
        fullRenderRange
      );
      assertDefined(
        initialResult.unifiedContentAST,
        'initial unifiedContentAST'
      );
      const initialCount = countRenderedLines(initialResult.unifiedContentAST);

      renderer.expandAll();
      renderer.collapseAll();

      const roundTripResult = await renderer.asyncRender(
        fileDiff,
        fullRenderRange
      );
      assertDefined(
        roundTripResult.unifiedContentAST,
        'roundTrip unifiedContentAST'
      );
      const roundTripCount = countRenderedLines(
        roundTripResult.unifiedContentAST
      );

      expect(roundTripCount).toBe(initialCount);
    });
  });
});
