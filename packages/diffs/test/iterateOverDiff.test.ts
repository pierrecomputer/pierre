import { describe, expect, test } from 'bun:test';

import { parseDiffFromFile } from '../src';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { fileNew, fileOld } from './mocks';

// NOTE(amadeus): These tests were written by an AI and they are probably
// pretty sloppy, but keeping them for now until we can have better tests
describe('iterateOverDiff', () => {
  const diff = parseDiffFromFile(
    { name: 'test.txt', contents: fileOld },
    { name: 'test.txt', contents: fileNew }
  );

  test('unified iteration produces expected sequence', () => {
    const results: Array<{
      lineIndex: number;
      hunkIndex: number;
      type: string;
      additionLineIndex: number | undefined;
      deletionLineIndex: number | undefined;
      additionLineNumber: number | undefined;
      deletionLineNumber: number | undefined;
      collapsedBefore: number;
    }> = [];

    iterateOverDiff({
      diff,
      diffStyle: 'unified',
      callback: (props) => {
        results.push({
          lineIndex: (() => {
            return (
              props.additionLine?.unifiedLineIndex ??
              props.deletionLine?.unifiedLineIndex ??
              0
            );
          })(),
          hunkIndex: props.hunkIndex,
          type: props.type,
          additionLineIndex: props.additionLine?.lineIndex,
          deletionLineIndex: props.deletionLine?.lineIndex,
          additionLineNumber: props.additionLine?.lineNumber,
          deletionLineNumber: props.deletionLine?.lineNumber,
          collapsedBefore: props.collapsedBefore,
        });
      },
    });

    // Check total lines matches expected
    expect(results.length).toBe(517);

    // First hunk starts at its unifiedLineStart (which is 3 because collapsedBefore=3)
    // The lineIndex is the actual unified line index, not a sequential counter
    expect(results[0].lineIndex).toBe(diff.hunks[0].unifiedLineStart);
    expect(results[0].hunkIndex).toBe(0);

    // First line should be context with collapsedBefore = 3 (from hunk 0)
    // Actually, hunk 0 has collapsedBefore=3, so first rendered line should signal this
    expect(results[0].collapsedBefore).toBe(3);
  });

  test('split iteration produces expected sequence', () => {
    const results: Array<{
      lineIndex: number;
      type: string;
      additionLineIndex: number | undefined;
      deletionLineIndex: number | undefined;
    }> = [];

    iterateOverDiff({
      diff,
      diffStyle: 'split',
      callback: (props) => {
        results.push({
          lineIndex: (() => {
            return (
              props.additionLine?.unifiedLineIndex ??
              props.deletionLine?.unifiedLineIndex ??
              0
            );
          })(),
          type: props.type,
          additionLineIndex: props.additionLine?.lineIndex,
          deletionLineIndex: props.deletionLine?.lineIndex,
        });
      },
    });

    // Check total lines matches expected for split mode
    expect(results.length).toBe(490);
  });

  test('expanded hunks work correctly', () => {
    const expandedHunks = new Map<
      number,
      { fromStart: number; fromEnd: number }
    >();
    expandedHunks.set(0, { fromStart: 2, fromEnd: 1 });

    const results: Array<{
      lineIndex: number;
      type: string;
      collapsedBefore: number;
    }> = [];

    iterateOverDiff({
      diff,
      diffStyle: 'unified',
      expandedHunks,
      callback: (props) => {
        results.push({
          lineIndex: (() => {
            return (
              props.additionLine?.unifiedLineIndex ??
              props.deletionLine?.unifiedLineIndex ??
              0
            );
          })(),
          type: props.type,
          collapsedBefore: props.collapsedBefore,
        });
      },
    });

    // With 3 collapsedBefore and fromStart=2, fromEnd=1, we should have:
    // - 2 context-expanded lines (fromStart)
    // - collapsedBefore = 0 (3 - 2 - 1 = 0, fully expanded)
    // - 1 context-expanded line (fromEnd)
    // - then hunk content

    // First 2 lines should be context-expanded with collapsedBefore=0
    expect(results[0].type).toBe('context-expanded');
    expect(results[0].collapsedBefore).toBe(0);
    expect(results[1].type).toBe('context-expanded');
    expect(results[1].collapsedBefore).toBe(0);
    // Third line should also be context-expanded (fromEnd)
    expect(results[2].type).toBe('context-expanded');
    expect(results[2].collapsedBefore).toBe(0);
  });

  test('windowing skips lines correctly', () => {
    const results: number[] = [];

    iterateOverDiff({
      diff,
      diffStyle: 'unified',
      startingLine: 10,
      totalLines: 5,
      callback: (props) => {
        results.push(
          (() => {
            return (
              props.additionLine?.unifiedLineIndex ??
              props.deletionLine?.unifiedLineIndex ??
              0
            );
          })()
        );
      },
    });

    // Should get exactly 5 consecutive lines
    expect(results.length).toBe(5);
    // Lines should be consecutive
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(results[i - 1] + 1);
    }
  });
});
