import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { parseDiffFromFile } from '../src';
import { baseline_iterateOverDiff } from '../src/utils/baseline_iterateOverDiff';
import type {
  DiffLineCallbackProps,
  IterateOverDiffProps,
} from '../src/utils/iterateOverDiff';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { fileNew, fileOld } from './mocks';

type IterateOverDiffFunction = (props: IterateOverDiffProps) => void;

interface IterateOverDiffFixture {
  files: Array<{
    summary: {
      name: string;
    };
    diff: IterateOverDiffProps['diff'];
  }>;
}

interface LineSnapshot {
  unifiedLineIndex: number;
  splitLineIndex: number;
  lineIndex: number;
  lineNumber: number;
  noEOFCR: boolean;
}

interface RowSnapshot {
  type: DiffLineCallbackProps['type'];
  hunkIndex: number;
  hasHunk: boolean;
  hunkSpecs: string | undefined;
  collapsedBefore: number;
  collapsedAfter: number;
  deletionLine: LineSnapshot | undefined;
  additionLine: LineSnapshot | undefined;
}

function createFileContents(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, index) => `${index + 1}`).join(
    '\n'
  );
}

function getRenderedLineEstimate(
  diff: IterateOverDiffProps['diff'],
  diffStyle: IterateOverDiffProps['diffStyle']
): number {
  if (diffStyle === 'split') return diff.splitLineCount;
  if (diffStyle === 'unified') return diff.unifiedLineCount;
  return Math.max(diff.splitLineCount, diff.unifiedLineCount);
}

function getDeepStart(
  diff: IterateOverDiffProps['diff'],
  diffStyle: IterateOverDiffProps['diffStyle'],
  totalLines: number
): number {
  const renderedRows = getRenderedLineEstimate(diff, diffStyle);
  return Math.max(
    0,
    Math.floor(renderedRows * 0.75) - Math.floor(totalLines / 2)
  );
}

function loadRealFixture(): IterateOverDiffFixture {
  return JSON.parse(
    readFileSync(
      new URL(
        '../scripts/fixtures/iterateOverDiffTopChanges.json',
        import.meta.url
      ),
      'utf8'
    )
  ) as IterateOverDiffFixture;
}

function cloneLineSnapshot(
  line: DiffLineCallbackProps['deletionLine']
): LineSnapshot | undefined {
  if (line == null) {
    return undefined;
  }
  return {
    unifiedLineIndex: line.unifiedLineIndex,
    splitLineIndex: line.splitLineIndex,
    lineIndex: line.lineIndex,
    lineNumber: line.lineNumber,
    noEOFCR: line.noEOFCR,
  };
}

function cloneRowSnapshot(props: DiffLineCallbackProps): RowSnapshot {
  return {
    type: props.type,
    hunkIndex: props.hunkIndex,
    hasHunk: props.hunk != null,
    hunkSpecs: props.hunk?.hunkSpecs,
    collapsedBefore: props.collapsedBefore,
    collapsedAfter: props.collapsedAfter,
    deletionLine: cloneLineSnapshot(props.deletionLine),
    additionLine: cloneLineSnapshot(props.additionLine),
  };
}

function captureRows(
  iterator: IterateOverDiffFunction,
  props: Omit<IterateOverDiffProps, 'callback'>,
  stopAfter?: number
): RowSnapshot[] {
  const rows: RowSnapshot[] = [];
  iterator({
    ...props,
    callback: (row) => {
      rows.push(cloneRowSnapshot(row));
      return stopAfter != null && rows.length >= stopAfter;
    },
  });
  return rows;
}

function expectMatchesBaseline(
  props: Omit<IterateOverDiffProps, 'callback'>,
  stopAfter?: number
) {
  const baselineRows = captureRows(baseline_iterateOverDiff, props, stopAfter);
  const rows = captureRows(iterateOverDiff, props, stopAfter);
  expect(rows).toEqual(baselineRows);
  return rows;
}

function checksumRows(
  iterator: IterateOverDiffFunction,
  props: Omit<IterateOverDiffProps, 'callback'>
): number {
  let checksum = 0;
  iterator({
    ...props,
    callback: (row) => {
      checksum += row.hunkIndex;
      checksum += row.type.length;
      checksum += row.collapsedBefore + row.collapsedAfter;
      checksum += row.deletionLine?.lineIndex ?? 0;
      checksum += row.deletionLine?.lineNumber ?? 0;
      checksum += row.deletionLine?.splitLineIndex ?? 0;
      checksum += row.deletionLine?.unifiedLineIndex ?? 0;
      checksum += row.additionLine?.lineIndex ?? 0;
      checksum += row.additionLine?.lineNumber ?? 0;
      checksum += row.additionLine?.splitLineIndex ?? 0;
      checksum += row.additionLine?.unifiedLineIndex ?? 0;
    },
  });
  return checksum;
}

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

  test('both-style deep windowing matches the baseline iterator', () => {
    const oldFile = {
      name: 'both-deep-window.txt',
      contents: createFileContents(1_000),
    };
    const newLines = oldFile.contents.split('\n');
    newLines[249] = 'changed-250';
    newLines[799] = 'changed-800';
    const largeDiff = parseDiffFromFile(oldFile, {
      ...oldFile,
      contents: newLines.join('\n'),
    });

    const rows = expectMatchesBaseline({
      diff: largeDiff,
      diffStyle: 'both',
      startingLine: 700,
      totalLines: 25,
      expandedHunks: true,
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.some(
        (row) =>
          (row.additionLine?.lineNumber ?? row.deletionLine?.lineNumber ?? 0) >
          700
      )
    ).toBe(true);
  });

  test('expanded leading context windows match the baseline iterator', () => {
    const oldFile = {
      name: 'expanded-leading-context.txt',
      contents: createFileContents(120),
    };
    const newLines = oldFile.contents.split('\n');
    newLines[59] = 'changed-60';
    const leadingDiff = parseDiffFromFile(oldFile, {
      ...oldFile,
      contents: newLines.join('\n'),
    });
    const expandedHunks = new Map([[0, { fromStart: 12, fromEnd: 8 }]]);

    const fromStartRows = expectMatchesBaseline({
      diff: leadingDiff,
      diffStyle: 'split',
      startingLine: 5,
      totalLines: 8,
      expandedHunks,
    });
    const fromEndRows = expectMatchesBaseline({
      diff: leadingDiff,
      diffStyle: 'split',
      startingLine: 12,
      totalLines: 8,
      expandedHunks,
    });

    expect(fromStartRows.every((row) => row.type === 'context-expanded')).toBe(
      true
    );
    expect(fromEndRows[0]?.collapsedBefore).toBeGreaterThan(0);
    expect(fromEndRows.every((row) => row.type === 'context-expanded')).toBe(
      true
    );
  });

  test('trailing collapsed context matches the baseline iterator', () => {
    const oldFile = {
      name: 'trailing-context.txt',
      contents: createFileContents(160),
    };
    const newLines = oldFile.contents.split('\n');
    newLines[1] = 'changed-2';
    const trailingDiff = parseDiffFromFile(oldFile, {
      ...oldFile,
      contents: newLines.join('\n'),
    });

    const rows = expectMatchesBaseline({
      diff: trailingDiff,
      diffStyle: 'unified',
    });

    expect(rows.some((row) => row.collapsedAfter > 0)).toBe(true);
  });

  test('early return stops at the same row as the baseline iterator', () => {
    const rows = expectMatchesBaseline(
      {
        diff,
        diffStyle: 'split',
        expandedHunks: true,
      },
      7
    );

    expect(rows).toHaveLength(7);
  });

  test('supports transient callback consumption without retaining row objects', () => {
    const checksumProps = {
      diff,
      diffStyle: 'both' as const,
      startingLine: 100,
      totalLines: 50,
      expandedHunks: true as const,
    };

    expect(checksumRows(iterateOverDiff, checksumProps)).toBe(
      checksumRows(baseline_iterateOverDiff, checksumProps)
    );
  });

  test('real fixture both-style deep windows match the baseline iterator', () => {
    const totalLines = 300;
    for (const { diff: fixtureDiff } of loadRealFixture().files) {
      expectMatchesBaseline({
        diff: fixtureDiff,
        diffStyle: 'both',
        startingLine: getDeepStart(fixtureDiff, 'both', totalLines),
        totalLines,
      });
    }
  });
});
