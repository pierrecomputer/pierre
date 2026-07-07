import { afterAll, describe, expect, test } from 'bun:test';

import { disposeHighlighter, FileDiff, parseDiffFromFile } from '../src';
import type { DiffsTextDocument } from '../src/types';
import { installDom } from './domHarness';

const twoHunkFileLineCount = 140;
const twoHunkChangedLines = [40, 100];

function createTwoHunkDiff() {
  const oldLines = Array.from(
    { length: twoHunkFileLineCount },
    (_, index) => `${index + 1}`
  );
  const newLines = oldLines.map((line, index) =>
    twoHunkChangedLines.includes(index + 1) ? `changed-${index + 1}` : line
  );

  const fileDiff = parseDiffFromFile(
    { name: 'two-hunks.ts', contents: `${oldLines.join('\n')}\n` },
    { name: 'two-hunks.ts', contents: `${newLines.join('\n')}\n` }
  );
  const [firstHunk, secondHunk] = fileDiff.hunks;
  if (
    fileDiff.hunks.length !== 2 ||
    firstHunk == null ||
    secondHunk == null ||
    firstHunk.collapsedBefore <= 0 ||
    secondHunk.collapsedBefore <= 0
  ) {
    throw new Error('Expected two hunks with collapsed leading context');
  }
  return fileDiff;
}

function makeTextDocument(lines: string[]): DiffsTextDocument {
  const text = lines.join('\n');
  return {
    lineCount: lines.length,
    getText: () => text,
    getLineText: (lineNumber: number, includeLineBreak = false) => {
      const line = lines[lineNumber] ?? '';
      return includeLineBreak ? line : line.replace(/\r?\n$/, '');
    },
  };
}

async function waitForRenderedCode(container: HTMLElement): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (container.shadowRoot?.querySelector('code') != null) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for FileDiff render');
}

function countSeparatorSlots(container: HTMLElement): number {
  return container.querySelectorAll('[slot^="hunk-separator-unified-"]').length;
}

describe('FileDiff unified edit separators', () => {
  afterAll(async () => {
    await disposeHighlighter();
  });

  test('applyDocumentChange refreshes function hunk separators', async () => {
    const { cleanup } = installDom();
    let instance: FileDiff<string> | undefined;
    try {
      const fileDiff = createTwoHunkDiff();
      const fileContainer = document.createElement('div');
      instance = new FileDiff<string>({
        disableErrorHandling: true,
        disableFileHeader: true,
        diffStyle: 'unified',
        hunkSeparators: () => {
          const span = document.createElement('span');
          span.textContent = 'separator';
          return span;
        },
      });

      instance.render({
        fileDiff,
        fileContainer,
        preventEmit: true,
        deferManagers: true,
      });
      await waitForRenderedCode(fileContainer);

      expect(countSeparatorSlots(fileContainer)).toBeGreaterThan(0);

      instance.applyDocumentChange(makeTextDocument(fileDiff.deletionLines));

      expect(countSeparatorSlots(fileContainer)).toBe(0);
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });
});
