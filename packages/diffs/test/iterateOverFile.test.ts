import { describe, expect, test } from 'bun:test';

import {
  type FileLineCallbackProps,
  iterateOverFile,
} from '../src/utils/iterateOverFile';
import { splitFileContents } from '../src/utils/splitFileContents';

describe('iterateOverFile', () => {
  test('basic iteration', () => {
    const lines = splitFileContents('line1\nline2\nline3\nline4\nline5');

    const results: FileLineCallbackProps[] = [];
    iterateOverFile({
      lines,
      callback(props) {
        results.push(props);
      },
    });

    expect(results).toHaveLength(5);

    // Verify all props on first line
    expect(results[0]).toEqual({
      lineIndex: 0, // 0-based
      lineNumber: 1, // 1-based
      content: 'line1\n',
      isLastLine: false,
    });

    // Verify middle line
    expect(results[2]).toEqual({
      lineIndex: 2,
      lineNumber: 3,
      content: 'line3\n',
      isLastLine: false,
    });

    // Verify last line (no trailing newline in source)
    expect(results[4]).toEqual({
      lineIndex: 4,
      lineNumber: 5,
      content: 'line5',
      isLastLine: true,
    });
  });

  test('empty file', () => {
    const lines = splitFileContents('');

    const results: FileLineCallbackProps[] = [];
    iterateOverFile({
      lines,
      callback(props) {
        results.push(props);
      },
    });

    expect(results).toHaveLength(0);
  });

  test('single line file', () => {
    const lines = splitFileContents('only line');

    const results: FileLineCallbackProps[] = [];
    iterateOverFile({
      lines,
      callback(props) {
        results.push(props);
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].isLastLine).toBe(true);
    expect(results[0].lineIndex).toBe(0);
    expect(results[0].lineNumber).toBe(1);
    expect(results[0].content).toBe('only line');
  });

  test('preserves empty lines', () => {
    const lines = splitFileContents('line1\n\nline3\n\n\nline6');

    const results: string[] = [];
    iterateOverFile({
      lines,
      callback({ content }) {
        results.push(content);
      },
    });

    // Newlines are preserved except on last line
    expect(results).toEqual(['line1\n', '\n', 'line3\n', '\n', '\n', 'line6']);
  });

  test('windowing', () => {
    const lines = splitFileContents(
      Array(100)
        .fill(0)
        .map((_, i) => `line${i}`)
        .join('\n')
    );

    // Windowing from start
    let results: number[] = [];
    iterateOverFile({
      lines,
      startingLine: 0,
      totalLines: 10,
      callback({ lineIndex }) {
        results.push(lineIndex);
      },
    });
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // Windowing from middle
    results = [];
    iterateOverFile({
      lines,
      startingLine: 50,
      totalLines: 10,
      callback({ lineIndex }) {
        results.push(lineIndex);
      },
    });
    expect(results).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);

    // Windowing past end - request more lines than available
    const shortLines = splitFileContents('line1\nline2\nline3\nline4\nline5');
    results = [];
    iterateOverFile({
      lines: shortLines,
      startingLine: 3,
      totalLines: 100,
      callback({ lineIndex }) {
        results.push(lineIndex);
      },
    });
    expect(results).toEqual([3, 4]); // Only lines 3 and 4 remain

    // Window starting beyond file end
    results = [];
    iterateOverFile({
      lines: shortLines,
      startingLine: 100,
      totalLines: 10,
      callback({ lineIndex }) {
        results.push(lineIndex);
      },
    });
    expect(results).toHaveLength(0);
  });

  test('last new line is not iterated over', () => {
    const lines = splitFileContents('line1\nline2\nline3\n\n\n');

    const results: string[] = [];
    iterateOverFile({
      lines,
      callback({ content }) {
        results.push(content);
      },
    });

    // Split creates: ['line1\n', 'line2\n', 'line3\n', '\n', '\n']
    // Only skips the LAST line if it's a newline, not all trailing newlines
    expect(results).toEqual(['line1\n', 'line2\n', 'line3\n', '\n']);
  });

  test('isLastLine with windowing', () => {
    const lines = splitFileContents(
      Array(10)
        .fill(0)
        .map((_, i) => `line${i}`)
        .join('\n')
    );

    // Window lines 5-7 (not including the actual last line of the file)
    const results: FileLineCallbackProps[] = [];
    iterateOverFile({
      lines,
      startingLine: 5,
      totalLines: 3,
      callback(props) {
        results.push(props);
      },
    });

    expect(results).toHaveLength(3);
    // isLastLine should be relative to full file, not the window
    expect(results[0].isLastLine).toBe(false); // Line 5 is not last in file
    expect(results[1].isLastLine).toBe(false); // Line 6 is not last in file
    expect(results[2].isLastLine).toBe(false); // Line 7 is not last in file

    // Window starting at actual last line
    results.length = 0;
    iterateOverFile({
      lines,
      startingLine: 9, // Last line (0-indexed)
      totalLines: 10,
      callback(props) {
        results.push(props);
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].lineIndex).toBe(9);
    expect(results[0].isLastLine).toBe(true);
  });

  test('early termination', () => {
    const lines = splitFileContents(
      Array(100)
        .fill(0)
        .map((_, i) => `line${i}`)
        .join('\n')
    );

    // Returning true stops iteration
    let results: number[] = [];
    iterateOverFile({
      lines,
      callback: ({ lineIndex }) => {
        results.push(lineIndex);
        if (lineIndex === 4) {
          return true; // Stop
        }
        return false;
      },
    });
    expect(results).toEqual([0, 1, 2, 3, 4]);

    // Returning false continues
    const shortLines = splitFileContents('a\nb\nc\nd\ne');
    results = [];
    iterateOverFile({
      lines: shortLines,
      callback: ({ lineIndex }) => {
        results.push(lineIndex);
        return false; // Continue
      },
    });
    expect(results).toEqual([0, 1, 2, 3, 4]);

    // Returning void continues
    results = [];
    iterateOverFile({
      lines: shortLines,
      callback: ({ lineIndex }) => {
        results.push(lineIndex);
        // Implicit undefined return - continue
      },
    });
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });
});
